import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the long-lived ElevenLabs key remains in the Electron main process", async () => {
  const [main, preload, renderer, bundle] = await Promise.all([
    read("electron/main.cjs"),
    read("electron/preload.cjs"),
    read("src/voice.js"),
    read("dist/client/index.html"),
  ]);

  assert.match(main, /process\.env\.ELEVENLABS_API_KEY/);
  assert.doesNotMatch(preload, /ELEVENLABS_API_KEY|xi-api-key/);
  assert.doesNotMatch(renderer, /ELEVENLABS_API_KEY|xi-api-key/);
  assert.doesNotMatch(bundle, /ELEVENLABS_API_KEY|xi-api-key/);
  assert.match(main, /single-use-token\/realtime_scribe/);
});

test("voice and microphone privileges are bound to the app main frame", async () => {
  const [main, preload] = await Promise.all([
    read("electron/main.cjs"),
    read("electron/preload.cjs"),
  ]);

  assert.match(main, /event\.senderFrame === mainWindow\.webContents\.mainFrame/);
  assert.match(main, /permission === "media" && ownsFrame/);
  assert.match(main, /!mediaTypes\.includes\("video"\)/);
  assert.match(preload, /voice:create-transcription-session/);
  assert.match(preload, /voice:audio-chunk/);
});
