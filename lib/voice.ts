// ElevenLabs text-to-speech for the voice channel. Audio is cached on disk by
// text hash, so each moment is synthesised once. Without a key the UI falls back
// to the browser's speech synthesis.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const AUDIO_DIR = path.join(fs.realpathSync(process.cwd()), ".data", "audio");

/** Cache entries must be regular files in the actual cache directory, never links. */
function cachePath(hash: string): string | null {
  // Only 32-char lowercase hex names, resolved strictly inside AUDIO_DIR.
  if (!/^[a-f0-9]{32}$/.test(hash)) return null;
  const file = path.resolve(AUDIO_DIR, `${hash}.mp3`);
  if (path.dirname(file) !== AUDIO_DIR || path.basename(file) !== `${hash}.mp3`) return null;
  return file;
}

function readCachedAudio(hash: string): Buffer | null {
  let fd: number | undefined;
  const file = cachePath(hash);
  if (!file) return null;
  try {
    if (fs.realpathSync(AUDIO_DIR) !== AUDIO_DIR) return null;
    const entry = fs.lstatSync(file);
    if (!entry.isFile()) return null;
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(fd);
    // Also protect platforms without O_NOFOLLOW against a replaced entry.
    if (!opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino) return null;
    return fs.readFileSync(fd);
  } catch {
    return null; // Missing, unsafe, or unreadable entries are cache misses.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function voiceEnabled(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export async function synthesize(text: string): Promise<Buffer | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  const voiceId = (process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb").replace(/[^A-Za-z0-9]/g, "");
  const model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
  const hash = createHash("sha256").update(`${voiceId}|${model}|${text}`).digest("hex").slice(0, 32);
  const file = cachePath(hash);
  if (!file) return null;
  const cached = readCachedAudio(hash);
  if (cached) return cached;
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
    fs.mkdirSync(AUDIO_DIR, { recursive: true, mode: 0o700 });
    if (fs.realpathSync(AUDIO_DIR) === AUDIO_DIR) {
      // Exclusive creation cannot overwrite an existing file or follow a link.
      fs.writeFileSync(file, buf, { flag: "wx", mode: 0o600 });
    }
  } catch { /* cache is best effort */ }
  return buf;
}
