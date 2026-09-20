# ElevenLabs voice setup

The renderer never receives the long-lived ElevenLabs API key. Electron uses it
to mint a single-use realtime transcription token and to proxy generated audio.

## Configure the desktop app

Set these values in the environment used to launch Electron:

```bash
export ELEVENLABS_API_KEY="..."
export ELEVENLABS_VOICE_ID="..."
```

Optional settings:

```bash
export ELEVENLABS_API_BASE="https://api.elevenlabs.io"
export ELEVENLABS_TRANSCRIPTION_MODEL="scribe_v2_realtime"
export ELEVENLABS_SPEECH_MODEL="eleven_flash_v2_5"
export ELEVENLABS_BRIEFING_MODEL="eleven_multilingual_v2"
```

Only official ElevenLabs regional API hosts are accepted. Voice input and text
to speech request `enable_logging=false`. ElevenLabs may return a warning when
the account is not eligible for provider-side zero retention; 2Bᵐᵉ surfaces
that warning in the voice interface. The app itself never stores audio and does
not persist transcripts.

## Create the 2Bᵐᵉ brand voice

With `ELEVENLABS_API_KEY` set, run:

```bash
npm run voice:design
```

The three private preview files are written under `.runtime/voice-previews/`,
which is git-ignored. After choosing a preview, create the final voice in the
ElevenLabs workspace and set its final ID as `ELEVENLABS_VOICE_ID`.
