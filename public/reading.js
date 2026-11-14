// Records Ian reading a book aloud (up to 25 minutes) and uploads it for Mom to hear and rate.
import { getMic } from "./cloudvoice.js";
export const MAX_SECONDS = 25 * 60;

let session = null;

function pickMimeType() {
  const options = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  if (!window.MediaRecorder) return null;
  return options.find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
}

export function isReading() {
  return Boolean(session);
}

// Must be called right inside the tap: iPhone only allows the microphone then.
// Returns a promise for the microphone stream.
// Uses the page's one shared microphone, so the phone doesn't ask again.
export function openMic() {
  return getMic();
}

// micPromise: from openMic(). onTick(seconds) every second; onFinish({ seconds, saved, error }) when done.
export async function startBookRecording({ micPromise, onTick, onFinish }) {
  if (session) return false;
  const mimeType = pickMimeType();
  let stream;
  try {
    stream = await micPromise;
  } catch (err) {
    onFinish({ seconds: 0, saved: false, error: `mic: ${err.name}` });
    return false;
  }
  if (mimeType === null) {
    onFinish({ seconds: 0, saved: false, error: "This browser cannot record audio." });
    return false;
  }

  const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  // Keep the screen on: a locked iPhone stops the microphone.
  let wakeLock = null;
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {}

  const started = Date.now();
  session = { recorder, stream, chunks, started, wakeLock, onFinish, timer: null, onHidden: null };
  session.timer = setInterval(() => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    onTick?.(seconds);
    if (seconds >= MAX_SECONDS) stopBookRecording();
  }, 250);
  // If the page is hidden (phone locked, app switched), save what we have.
  session.onHidden = () => document.hidden && stopBookRecording();
  document.addEventListener("visibilitychange", session.onHidden);

  recorder.start(10000); // hand over data every 10 s, so little is lost if something goes wrong
  return true;
}

export async function stopBookRecording() {
  if (!session) return;
  const s = session;
  session = null;
  clearInterval(s.timer);
  document.removeEventListener("visibilitychange", s.onHidden);
  const seconds = Math.min(MAX_SECONDS, Math.round((Date.now() - s.started) / 1000));

  await new Promise((resolve) => {
    s.recorder.onstop = resolve;
    if (s.recorder.state !== "inactive") s.recorder.stop();
    else resolve();
  });
  // The shared microphone stays open for next time.
  s.wakeLock?.release?.().catch(() => {});

  if (seconds < 5) return s.onFinish({ seconds, saved: false, error: "too short" });
  const type = (s.recorder.mimeType || s.chunks[0]?.type || "audio/mp4").split(";")[0];
  const blob = new Blob(s.chunks, { type });
  try {
    const res = await fetch("/api/reading", {
      method: "POST",
      headers: { "Content-Type": type, "X-Duration": String(seconds) },
      body: blob,
    });
    if (!res.ok) throw new Error(`upload ${res.status}`);
    s.onFinish({ seconds, saved: true });
  } catch (err) {
    s.onFinish({ seconds, saved: false, error: err.message });
  }
}
