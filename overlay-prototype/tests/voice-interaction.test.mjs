import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = {
  localStorage: { getItem: () => null, setItem: () => {} },
  desktopAPI: {
    voice: {
      getStatus: async () => ({ ok: true, configured: true }),
      onAudioChunk: () => () => {},
    },
  },
  clearTimeout,
  setTimeout,
};

const { VoiceController } = await import("../src/voice.js");

test("a quick click starts listening and stays active until the next click", () => {
  const voice = new VoiceController();
  let starts = 0;
  let stops = 0;
  voice.startListening = () => { starts += 1; };
  voice.stopListening = () => { stops += 1; };

  voice.beginListeningPress();
  voice.endListeningPress();
  assert.equal(starts, 1);
  assert.equal(stops, 0);

  voice.state = { ...voice.state, phase: "listening" };
  voice.beginListeningPress();
  voice.endListeningPress();
  assert.equal(starts, 1);
  assert.equal(stops, 1);
});

test("holding the button retains push-to-talk release behavior", () => {
  const voice = new VoiceController();
  let stops = 0;
  voice.startListening = () => {};
  voice.stopListening = () => { stops += 1; };

  voice.beginListeningPress();
  voice.pressStartedAt -= 500;
  voice.endListeningPress();
  assert.equal(stops, 1);
});
