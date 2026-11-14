// Azure AI Speech: turns Ginger's words into audio (TTS) and Ian's voice into text (STT).
// This avoids the phone's own speech features, which can be blocked by Screen Time
// or muted, and gives every device the same natural American voice.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const KEY = process.env.AZURE_SPEECH_KEY || "";
const REGION = process.env.AZURE_SPEECH_REGION || "eastus";
// Lets tests point at a local fake server instead of Azure.
const TTS_URL = process.env.AZURE_TTS_URL || `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
const STT_URL =
  process.env.AZURE_STT_URL ||
  `https://${REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`;

export const speechEnabled = Boolean(KEY);
export const RATE = 0.85;

// American English male voices the parent can choose from.
export const VOICES = [
  { id: "en-US-AndrewNeural", label: "Andrew – warm, friendly" },
  { id: "en-US-BrianNeural", label: "Brian – young, casual" },
  { id: "en-US-DavisNeural", label: "Davis – calm" },
  { id: "en-US-JasonNeural", label: "Jason – bright" },
  { id: "en-US-TonyNeural", label: "Tony – cheerful" },
  { id: "en-US-GuyNeural", label: "Guy – clear, classic" },
  { id: "en-US-ChristopherNeural", label: "Christopher – gentle" },
  { id: "en-US-EricNeural", label: "Eric – soft" },
];
export const DEFAULT_VOICE = process.env.AZURE_VOICE || "en-US-AndrewNeural";

const escapeXml = (s) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

// Returns MP3 audio for the text. Results are cached on disk, so the fixed
// lines (feeding, petting) only cost once.
export async function tts(text, voice, cacheDir) {
  if (!VOICES.some((v) => v.id === voice)) voice = DEFAULT_VOICE;
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 600);
  const hash = crypto.createHash("sha256").update(`${voice}|${RATE}|${clean}`).digest("hex").slice(0, 32);
  const file = path.join(cacheDir, `${hash}.mp3`);
  if (fs.existsSync(file)) return fs.readFileSync(file);

  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
    `<voice name="${voice}"><prosody rate="${RATE}">${escapeXml(clean)}</prosody></voice></speak>`;
  const res = await fetch(TTS_URL, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "ginger-pet",
    },
    body: ssml,
  });
  if (!res.ok) throw new Error(`Azure TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const audio = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, audio);
  return audio;
}

// Takes 16 kHz mono 16-bit WAV audio and returns the recognized English text.
export async function stt(wav) {
  const res = await fetch(`${STT_URL}?language=en-US&format=simple&profanity=masked`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": KEY,
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      Accept: "application/json",
    },
    body: wav,
  });
  if (!res.ok) throw new Error(`Azure STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.RecognitionStatus === "Success" ? String(data.DisplayText || "").trim() : "";
}

// Short-lived token (valid 10 minutes) so the browser can stream speech to Azure
// directly without ever seeing the key. Cached for 8 minutes.
const TOKEN_URL = process.env.AZURE_TOKEN_URL || `https://${REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
let cachedToken = null;
export async function speechToken() {
  if (cachedToken && Date.now() - cachedToken.at < 8 * 60 * 1000) return cachedToken;
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Ocp-Apim-Subscription-Key": KEY }, body: "" });
  if (!res.ok) throw new Error(`Azure token ${res.status}`);
  cachedToken = { token: await res.text(), region: REGION, at: Date.now() };
  return cachedToken;
}
