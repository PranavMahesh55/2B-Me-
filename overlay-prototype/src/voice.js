import { useSyncExternalStore } from "react";

/** @typedef {"idle"|"requesting_permission"|"listening"|"transcribing"|"reviewing"|"thinking"|"speaking"|"cancelled"|"error"} VoiceState */
/** @typedef {{enabled: boolean, spokenResponses: boolean, volume: number, autoLanguage: boolean, briefingLength: "short"|"standard"}} VoicePreferences */

const DEFAULT_PREFERENCES = {
  enabled: true,
  spokenResponses: true,
  volume: 0.82,
  autoLanguage: true,
  briefingLength: "standard",
};

const KEYTERMS = ["2Bme", "workflow", "focus score", "friction score", "Touch ID"];

function loadPreferences() {
  try {
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(window.localStorage.getItem("2bme-voice-preferences") || "{}") };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function pcm16Base64(floatSamples, sourceRate, targetRate = 16000) {
  const ratio = sourceRate / targetRate;
  const length = Math.max(1, Math.round(floatSamples.length / ratio));
  const pcm = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(floatSamples.length, Math.floor((index + 1) * ratio));
    let total = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) total += floatSamples[sourceIndex];
    const sample = Math.max(-1, Math.min(1, total / Math.max(1, end - start)));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return window.btoa(binary);
}

function voiceMessage(error) {
  const code = error?.code || error?.error;
  if (code === "voice_not_configured") return "Voice needs an ElevenLabs API key and brand voice ID in the desktop app.";
  if (code === "voice_quota_exceeded") return "The ElevenLabs voice quota has been reached. You can keep using text.";
  if (code === "NotAllowedError") return "Microphone access was not granted. You can keep using text.";
  return error?.message || "Voice is unavailable right now. You can keep using text.";
}

export class VoiceController {
  constructor() {
    this.state = {
      phase: "idle",
      transcript: "",
      partialTranscript: "",
      error: null,
      configured: null,
      retentionWarning: null,
      preferences: loadPreferences(),
    };
    this.listeners = new Set();
    this.socket = null;
    this.stream = null;
    this.audioContext = null;
    this.processor = null;
    this.source = null;
    this.silentGain = null;
    this.commitTimer = null;
    this.currentAudio = null;
    this.currentAudioUrl = null;
    this.currentSpeechId = null;
    this.speechRequests = new Map();
    this.captureRequested = false;
    this.pressStartedAt = 0;
    this.pressWasActive = false;
    this.removeChunkListener = window.desktopAPI?.voice?.onAudioChunk?.((payload) => this.onAudioChunk(payload));
    this.refreshStatus();
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  update(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  async refreshStatus() {
    if (!window.desktopAPI?.voice) {
      this.update({ configured: false });
      return;
    }
    const status = await window.desktopAPI.voice.getStatus().catch(() => null);
    this.update({ configured: Boolean(status?.configured), status });
  }

  updatePreferences(patch) {
    const preferences = { ...this.state.preferences, ...patch };
    window.localStorage.setItem("2bme-voice-preferences", JSON.stringify(preferences));
    this.update({ preferences });
    if (!preferences.enabled) this.cancel();
  }

  setTranscript(transcript) {
    this.update({ transcript, partialTranscript: "", phase: transcript.trim() ? "reviewing" : "idle", error: null });
  }

  markThinking() {
    this.update({ phase: "thinking", partialTranscript: "", error: null });
  }

  markIdle() {
    this.update({ phase: "idle", partialTranscript: "", error: null });
  }

  beginListeningPress() {
    this.pressStartedAt = Date.now();
    this.pressWasActive = ["requesting_permission", "listening"].includes(this.state.phase);
    if (!this.pressWasActive) this.startListening();
  }

  endListeningPress() {
    const heldLongEnough = Date.now() - this.pressStartedAt >= 450;
    const shouldStop = this.pressWasActive || heldLongEnough;
    this.pressStartedAt = 0;
    this.pressWasActive = false;
    // A quick click intentionally leaves capture running. The next click stops
    // it, while a press held for 450ms or more retains push-to-talk behavior.
    if (shouldStop) this.stopListening();
  }

  toggleListening() {
    if (["requesting_permission", "listening"].includes(this.state.phase)) this.stopListening();
    else this.startListening();
  }

  cleanupCapture({ closeSocket = true } = {}) {
    window.clearTimeout(this.commitTimer);
    this.commitTimer = null;
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.silentGain?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.audioContext?.close().catch(() => {});
    if (closeSocket && this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
    this.processor = null;
    this.source = null;
    this.silentGain = null;
    this.stream = null;
    this.audioContext = null;
    if (closeSocket) this.socket = null;
  }

  async startListening() {
    if (!this.state.preferences.enabled || this.state.phase === "listening" || this.state.phase === "requesting_permission") return;
    this.stopSpeaking();
    this.cleanupCapture();
    this.captureRequested = true;
    this.update({ phase: "requesting_permission", transcript: "", partialTranscript: "", error: null, retentionWarning: null });
    try {
      if (!window.desktopAPI?.voice) throw { code: "voice_not_configured" };
      const session = await window.desktopAPI.voice.createTranscriptionSession();
      if (!session?.ok) throw session;
      if (!this.captureRequested) {
        this.update({ phase: "idle" });
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (!this.captureRequested) {
        stream.getTracks().forEach((track) => track.stop());
        this.update({ phase: "idle" });
        return;
      }
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;

      const params = new URLSearchParams({
        model_id: session.model,
        token: session.token,
        audio_format: "pcm_16000",
        commit_strategy: "manual",
        include_language_detection: String(this.state.preferences.autoLanguage),
        no_verbatim: "true",
        filter_background_audio: "true",
        enable_logging: "false",
      });
      KEYTERMS.forEach((term) => params.append("keyterms", term));
      const socket = new WebSocket(`${session.websocketBase}/v1/speech-to-text/realtime?${params}`);

      this.stream = stream;
      this.audioContext = audioContext;
      this.source = source;
      this.processor = processor;
      this.silentGain = silentGain;
      this.socket = socket;

      socket.addEventListener("open", () => {
        if (!this.captureRequested) {
          this.cleanupCapture();
          this.update({ phase: "idle" });
          return;
        }
        processor.onaudioprocess = (event) => {
          if (socket.readyState !== WebSocket.OPEN || this.state.phase !== "listening") return;
          socket.send(JSON.stringify({
            message_type: "input_audio_chunk",
            audio_base_64: pcm16Base64(event.inputBuffer.getChannelData(0), audioContext.sampleRate),
            commit: false,
            sample_rate: 16000,
          }));
        };
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioContext.destination);
        this.update({ phase: "listening" });
      });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.message_type === "partial_transcript") {
          this.update({ partialTranscript: message.text || "" });
        } else if (message.message_type === "committed_transcript" || message.message_type === "committed_transcript_with_timestamps") {
          const transcript = message.text?.trim() || this.state.partialTranscript.trim();
          this.cleanupCapture();
          this.update({ phase: transcript ? "reviewing" : "idle", transcript, partialTranscript: "" });
        } else if (message.message_type === "warning") {
          this.update({ retentionWarning: message.warning || "Provider zero-retention was requested but could not be confirmed." });
        } else if (message.error || message.message_type?.endsWith("_error")) {
          this.fail(new Error(message.error || "Transcription failed."));
        }
      });
      socket.addEventListener("error", () => this.fail(new Error("The realtime transcription connection failed.")));
      socket.addEventListener("close", () => {
        if (this.state.phase !== "transcribing") return;
        const transcript = (this.state.transcript || this.state.partialTranscript).trim();
        this.cleanupCapture({ closeSocket: false });
        this.socket = null;
        this.update({ phase: transcript ? "reviewing" : "idle", transcript, partialTranscript: "" });
      });
    } catch (error) {
      this.fail(error);
    }
  }

  stopListening() {
    this.captureRequested = false;
    if (this.state.phase === "requesting_permission") {
      this.update({ phase: "cancelled" });
      return;
    }
    if (this.state.phase !== "listening") return;
    this.update({ phase: "transcribing" });
    this.processor.onaudioprocess = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.socket?.readyState === WebSocket.OPEN) {
      const silence = new Int16Array(320);
      const bytes = new Uint8Array(silence.buffer);
      let binary = "";
      for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
      this.socket.send(JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: window.btoa(binary),
        commit: true,
        sample_rate: 16000,
      }));
      this.commitTimer = window.setTimeout(() => {
        const transcript = (this.state.transcript || this.state.partialTranscript).trim();
        this.cleanupCapture();
        this.update({ phase: transcript ? "reviewing" : "idle", transcript, partialTranscript: "" });
      }, 4500);
    } else {
      this.cleanupCapture();
      this.update({ phase: "idle" });
    }
  }

  onAudioChunk(payload) {
    const pending = this.speechRequests.get(payload?.requestId);
    if (!pending) return;
    if (payload.chunk) pending.chunks.push(payload.chunk);
    if (payload.contentType) pending.contentType = payload.contentType;
    if (!payload.done) return;
    this.speechRequests.delete(payload.requestId);
    if (payload.error) {
      pending.reject({ code: payload.error, message: "Speech generation failed." });
      return;
    }
    pending.resolve({ chunks: pending.chunks, contentType: payload.contentType || pending.contentType || "audio/mpeg" });
  }

  async speak(text, kind = "response") {
    if (!this.state.preferences.enabled || !this.state.preferences.spokenResponses || !text?.trim()) {
      this.markIdle();
      return false;
    }
    this.stopSpeaking();
    if (!window.desktopAPI?.voice) {
      this.update({ phase: "error", error: "Spoken responses are available in the desktop app." });
      return false;
    }
    const requestId = `speech_${crypto.randomUUID().replaceAll("-", "")}`;
    this.currentSpeechId = requestId;
    this.update({ phase: "speaking", error: null });
    try {
      const audioPromise = new Promise((resolve, reject) => {
        this.speechRequests.set(requestId, { chunks: [], resolve, reject, contentType: "audio/mpeg" });
      });
      const resultPromise = window.desktopAPI.voice.synthesize({ requestId, text: text.trim(), kind }).then((result) => {
        if (!result?.ok) {
          const pending = this.speechRequests.get(requestId);
          this.speechRequests.delete(requestId);
          pending?.reject(result);
        }
        return result;
      });
      const [{ chunks, contentType }, result] = await Promise.all([audioPromise, resultPromise]);
      if (!result?.ok) throw result;
      if (this.currentSpeechId !== requestId) return false;
      const blob = new Blob(chunks, { type: contentType });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = this.state.preferences.volume;
      this.currentAudio = audio;
      this.currentAudioUrl = url;
      audio.addEventListener("ended", () => this.stopSpeaking());
      audio.addEventListener("error", () => this.fail(new Error("The generated audio could not be played.")));
      await audio.play();
      return true;
    } catch (error) {
      if (error?.code !== "cancelled") this.fail(error);
      return false;
    }
  }

  stopSpeaking() {
    if (this.currentSpeechId) window.desktopAPI?.voice?.cancel?.(this.currentSpeechId);
    this.currentSpeechId = null;
    this.currentAudio?.pause();
    this.currentAudio = null;
    if (this.currentAudioUrl) URL.revokeObjectURL(this.currentAudioUrl);
    this.currentAudioUrl = null;
    this.speechRequests.forEach(({ reject }) => reject({ code: "cancelled" }));
    this.speechRequests.clear();
    if (this.state.phase === "speaking") this.update({ phase: "idle" });
  }

  cancel() {
    this.captureRequested = false;
    this.pressStartedAt = 0;
    this.pressWasActive = false;
    this.stopSpeaking();
    this.cleanupCapture();
    this.update({ phase: "cancelled", transcript: "", partialTranscript: "", error: null });
    window.setTimeout(() => {
      if (this.state.phase === "cancelled") this.update({ phase: "idle" });
    }, 500);
  }

  fail(error) {
    this.captureRequested = false;
    this.cleanupCapture();
    this.update({ phase: "error", error: voiceMessage(error), partialTranscript: "" });
  }
}

export const voiceController = new VoiceController();

export function useVoice() {
  const state = useSyncExternalStore(voiceController.subscribe, voiceController.getSnapshot);
  return { ...state, controller: voiceController };
}

export const VoiceStates = Object.freeze([
  "idle", "requesting_permission", "listening", "transcribing", "reviewing", "thinking", "speaking", "cancelled", "error",
]);
