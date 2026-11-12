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

let finishCurrent = null;

export function stopAudio() {
  player.pause();
  finishCurrent?.();
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
  finishCurrent?.(); // a new line replaces whatever was playing
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (finishCurrent === finish) finishCurrent = null;
      URL.revokeObjectURL(url);
      resolve();
    };
    finishCurrent = finish;
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
let starting = false;

export function isRecording() {
  return Boolean(rec) || starting;
}

// Starts listening.
// - onReady(): the microphone is really recording now (show "talk now").
// - onStopping(): recording just ended; the words are being recognized.
// - onDone(text): what the server heard, or "" if nothing.
// Stops by itself when Ian stops talking for 1.5 s, or after 12 s.
// Conversation mode passes one AudioContext (made during a tap) for every turn,
// because iPhone only lets a page start audio from a tap.
export function createAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  ctx.resume();
  return ctx;
}

export async function startRecording({ ctx: sharedCtx, onReady, onStopping, onDone, onError }) {
  if (isRecording()) return false;
  starting = true;
  const ctx = sharedCtx || createAudioContext(); // created inside the tap so iPhone allows it
  const ownCtx = !sharedCtx;
  if (ctx.state === "suspended") ctx.resume();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (err) {
    starting = false;
    if (ownCtx) ctx.close();
    onError?.(`mic: ${err.name}`);
    return false;
  }
  if (!starting) {
    // Tapped again (or cancelled) while the mic was still starting.
    stream.getTracks().forEach((t) => t.stop());
    if (ownCtx) ctx.close();
    return false;
  }
  starting = false;

  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const chunks = [];
  let readyAt = 0;
  let spoke = false;
  let lastLoud = 0;
  let quietest = Infinity;

  rec = { ctx, ownCtx, stream, source, proc, chunks, onStopping, onDone, onError, spoke: () => spoke };
  proc.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    const now = performance.now();
    if (!readyAt) {
      readyAt = now;
      lastLoud = now;
      onReady?.();
    }
    chunks.push(new Float32Array(data));
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const level = Math.sqrt(sum / data.length);
    // Adapt to the room: speech is anything clearly louder than the quietest moment so far.
    quietest = Math.min(quietest, level);
    const threshold = Math.max(0.004, quietest * 3);
    if (level > threshold) {
      spoke = true;
      lastLoud = now;
    }
    const elapsed = now - readyAt;
    if ((spoke && elapsed > 800 && now - lastLoud > 1500) || elapsed > 12000 || (!spoke && elapsed > 7000)) {
      stopRecording({ auto: true });
    }
  };
  source.connect(proc);
  proc.connect(ctx.destination);
  return true;
}

// Closes the mic. Returns the recording, or null if nothing was recording.
function closeMic() {
  if (starting) {
    starting = false; // startRecording will cancel when the mic opens
    return null;
  }
  if (!rec) return null;
  const r = rec;
  rec = null;
  r.proc.onaudioprocess = null;
  r.proc.disconnect();
  r.source.disconnect();
  // Releasing the mic also moves iPhone audio back to the loud speaker.
  r.stream.getTracks().forEach((t) => t.stop());
  if (r.ownCtx) r.ctx.close();
  return r;
}

// Throws the recording away without recognizing it.
export function cancelRecording() {
  closeMic();
}

// auto: stopped by itself. Then a recording with no speech is not sent at all.
// A tap on stop always sends what was recorded.
export async function stopRecording({ auto = false } = {}) {
  const r = closeMic();
  if (!r) return;
  const rate = r.ctx.sampleRate;
  r.onStopping?.();
  const seconds = r.chunks.reduce((n, c) => n + c.length, 0) / rate;
  if (seconds < 0.4 || (auto && !r.spoke())) return r.onDone("");
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
