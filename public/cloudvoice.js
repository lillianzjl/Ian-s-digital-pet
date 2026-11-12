// Ginger's voice through the server (Azure Speech), so it does not depend on the
// phone's own speech features. Plays audio with a normal <audio> element and records
// the microphone with Web Audio, sending a small 16 kHz WAV to the server.

const TARGET_RATE = 16000;

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, str) => [...str].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function downsample(chunks, fromRate) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  const ratio = fromRate / TARGET_RATE;
  const out = new Float32Array(Math.floor(total / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(total, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += all[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

// ---------- Playback ----------
const player = new Audio();
player.setAttribute("playsinline", "");
const SILENCE = URL.createObjectURL(encodeWav(new Float32Array(1600), TARGET_RATE));

// Must be called inside a tap: lets the page play sound later without another tap.
export function unlockAudio() {
  player.src = SILENCE;
  player.play().catch(() => {});
}

export function stopAudio() {
  player.pause();
}

// Plays the text in Ginger's voice. Calls onStart when sound begins; resolves when done.
export async function cloudSpeak(text, { onStart, onError } = {}) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const info = await res.json().catch(() => ({}));
    throw new Error(`tts ${res.status} ${info.error || ""}`.trim());
  }
  const url = URL.createObjectURL(await res.blob());
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve();
    };
    player.onplaying = () => onStart?.();
    player.onended = finish;
    player.onpause = finish;
    player.onerror = () => { onError?.("sound: cannot play"); finish(); };
    player.src = url;
    player.play().catch((err) => {
      // AbortError just means the sound was stopped on purpose (e.g. the mic was tapped).
      if (err.name !== "AbortError") onError?.(`sound: ${err.name}`);
      finish();
    });
    setTimeout(finish, 30000);
  });
}

// ---------- Recording ----------
let rec = null;

export function isRecording() {
  return Boolean(rec);
}

// Starts listening. Stops by itself after Ian stops talking (or after 9 seconds),
// then calls onDone(text) with what the server heard, or onDone("") if nothing.
export async function startRecording({ onDone, onError }) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx(); // created inside the tap so iPhone allows it
  ctx.resume();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
  } catch (err) {
    ctx.close();
    onError?.(`mic: ${err.name}`);
    return false;
  }
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  const started = performance.now();
  let spoke = false;
  let lastLoud = started;

  rec = { ctx, stream, source, proc, chunks, onDone, onError, spoke: () => spoke };
  proc.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const now = performance.now();
    if (Math.sqrt(sum / data.length) > 0.015) {
      spoke = true;
      lastLoud = now;
    }
    if ((spoke && now - lastLoud > 1300) || now - started > 9000 || (!spoke && now - started > 6000)) stopRecording();
  };
  source.connect(proc);
  proc.connect(ctx.destination);
  return true;
}

export async function stopRecording() {
  if (!rec) return;
  const r = rec;
  rec = null;
  r.proc.onaudioprocess = null;
  r.proc.disconnect();
  r.source.disconnect();
  // Releasing the mic also moves iPhone audio back to the loud speaker.
  r.stream.getTracks().forEach((t) => t.stop());
  const rate = r.ctx.sampleRate;
  r.ctx.close();
  if (!r.spoke() || !r.chunks.length) return r.onDone("");
  try {
    const wav = encodeWav(downsample(r.chunks, rate), TARGET_RATE);
    const res = await fetch("/api/stt", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
    const out = await res.json();
    if (!res.ok) throw new Error(`stt ${res.status} ${out.error || ""}`.trim());
    r.onDone(out.text || "");
  } catch (err) {
    r.onError?.(err.message);
    r.onDone("");
  }
}
