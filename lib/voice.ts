// ElevenLabs text-to-speech for the voice channel. Audio is cached on disk by
// text hash, so each moment is synthesised once. Without a key the UI falls back
// to the browser's speech synthesis.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const AUDIO_DIR = path.join(process.cwd(), ".data", "audio");

export function voiceEnabled(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export async function synthesize(text: string): Promise<Buffer | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  const voiceId = (process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb").replace(/[^A-Za-z0-9]/g, "");
  const model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
  const hash = createHash("sha256").update(`${voiceId}|${model}|${text}`).digest("hex").slice(0, 32);
  const file = path.join(AUDIO_DIR, `${hash}.mp3`);
  try {
    return fs.readFileSync(file);
  } catch { /* not cached */ }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: text.slice(0, 600), model_id: model }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    console.error(`[voice] ElevenLabs returned ${res.status}`);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  try {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    fs.writeFileSync(file, buf);
  } catch { /* cache is best effort */ }
  return buf;
}
