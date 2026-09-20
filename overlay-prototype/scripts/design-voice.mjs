import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY is required.");
  process.exitCode = 1;
} else {
  const apiBase = process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io";
  const host = new URL(apiBase);
  const allowed = new Set([
    "api.elevenlabs.io",
    "api.us.elevenlabs.io",
    "api.eu.residency.elevenlabs.io",
    "api.in.residency.elevenlabs.io",
    "api.sg.residency.elevenlabs.io",
  ]);
  if (host.protocol !== "https:" || !allowed.has(host.hostname)) {
    throw new Error("ELEVENLABS_API_BASE must be an official ElevenLabs HTTPS endpoint.");
  }

  const response = await fetch(`${host.origin}/v1/text-to-voice/design`, {
    method: "POST",
    headers: { "content-type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({
      model_id: "eleven_multilingual_ttv_v2",
      voice_description: "A calm, warm, gender-neutral digital companion. Clear and concise, quietly confident, never theatrical, with a modern North American accent and a gentle sense of momentum.",
      text: "Here is your 2B me briefing. Your focus is steady, the evidence is clear, and there is one workflow ready for your review. Nothing will run without your approval.",
      auto_generate_text: false,
      should_enhance: true,
    }),
  });
  if (!response.ok) {
    let providerReason = "";
    let providerStatus = "";
    try {
      const errorBody = await response.json();
      const detail = errorBody?.detail;
      providerStatus = typeof detail === "object" ? detail?.status || "" : "";
      const message = typeof detail === "object" ? detail?.message : detail;
      providerReason = [providerStatus, message]
        .filter((value) => typeof value === "string" && value.trim())
        .join(": ");
    } catch {
      // Some provider errors do not include a JSON response body.
    }

    const guidance = providerStatus === "feature_unavailable"
      ? " ElevenLabs requires a paid plan to create a custom voice through the API. You can upgrade, or use an existing voice ID with 2Bme instead."
      : response.status === 403
        ? " In ElevenLabs, open Developers > API Keys and enable Voice Generation/Voice Design access for this key. If IP restrictions are enabled, add this Mac's current public IP or temporarily remove the restriction."
      : response.status === 401
        ? " Check that ELEVENLABS_API_KEY contains a current ElevenLabs API key."
        : response.status === 429
          ? " The account has reached a rate or credit limit. Check usage and billing in ElevenLabs."
          : "";
    const reason = providerReason ? ` ElevenLabs says: ${providerReason}.` : "";
    throw new Error(`Voice Design failed (${response.status}).${reason}${guidance}`);
  }
  const body = await response.json();
  const outputDirectory = path.resolve(".runtime", "voice-previews");
  await mkdir(outputDirectory, { recursive: true });
  for (const [index, preview] of (body.previews || []).entries()) {
    const filename = path.join(outputDirectory, `2bme-brand-${index + 1}.mp3`);
    await writeFile(filename, Buffer.from(preview.audio_base_64, "base64"));
    console.log(`${filename}  generated_voice_id=${preview.generated_voice_id}`);
  }
  console.log("Listen to the previews, create the selected voice in ElevenLabs, then set ELEVENLABS_VOICE_ID to its final voice ID.");
}
