import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chat, extractMaterial, demoMode } from "./lib/claude.js";
import { tts, stt, speechEnabled, VOICES, DEFAULT_VOICE } from "./lib/speech.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(here, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const LOG_FILE = path.join(DATA_DIR, "chatlog.json");
const TTS_CACHE = path.join(DATA_DIR, "tts-cache");
const READINGS_DIR = path.join(DATA_DIR, "readings");
const READINGS_FILE = path.join(DATA_DIR, "readings.json");
const MAX_READINGS = 100; // oldest recordings are removed after this
const PARENT_PIN = process.env.PARENT_PIN || "";
const SITE_PASSWORD = process.env.SITE_PASSWORD || "";
const CHATS_PER_HOUR = Number(process.env.CHATS_PER_HOUR) || 60;
const CHATS_PER_DAY = Number(process.env.CHATS_PER_DAY) || 150;
const PORT = Number(process.env.PORT) || 3000;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(READINGS_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
const loadState = () => ({ topic: "", notes: "", activeMaterialId: null, materials: [], voice: DEFAULT_VOICE, ...readJson(STATE_FILE, {}) });
const saveState = (s) => writeJson(STATE_FILE, s);

const app = express();
app.set("trust proxy", true);

// Optional password for the whole site, so strangers who find the address
// cannot use the Claude API. The browser asks once and remembers it.
if (SITE_PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.get("authorization") || "").split(" ");
    const password = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":") : "";
    const ok = password.length === SITE_PASSWORD.length &&
      crypto.timingSafeEqual(Buffer.from(password), Buffer.from(SITE_PASSWORD));
    if (ok) return next();
    res.set("WWW-Authenticate", 'Basic realm="Ginger", charset="UTF-8"').status(401).send("Password needed");
  });
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(here, "public")));
app.use("/vendor/three", express.static(path.join(here, "node_modules/three")));
app.get("/parent", (_req, res) => res.sendFile(path.join(here, "public/parent.html")));

// ---------- Ian's side ----------
app.get("/api/pet", (_req, res) => {
  const s = loadState();
  const active = s.materials.find((m) => m.id === s.activeMaterialId);
  // The newest reading Mom has rated, so Ginger can tell Ian about his stars.
  const rated = loadReadings().filter((r) => r.stars).sort((a, b) => b.ratedAt.localeCompare(a.ratedAt))[0];
  res.json({
    topic: s.topic,
    material: active ? active.name : null,
    demo: demoMode,
    cloudVoice: speechEnabled,
    latestRating: rated ? { id: rated.id, stars: rated.stars, ratedAt: rated.ratedAt } : null,
  });
});

// Safety net on spending: limits on chat replies per hour and per day for the whole site.
const windows = { hour: { start: Date.now(), count: 0, ms: 3600_000 }, day: { start: Date.now(), count: 0, ms: 86400_000 } };
function chatAllowed() {
  const now = Date.now();
  for (const w of Object.values(windows)) {
    if (now - w.start > w.ms) {
      w.start = now;
      w.count = 0;
    }
  }
  if (windows.hour.count >= CHATS_PER_HOUR || windows.day.count >= CHATS_PER_DAY) return false;
  windows.hour.count++;
  windows.day.count++;
  return true;
}

app.post("/api/chat", async (req, res) => {
  if (!chatAllowed()) {
    return res.json({ say: "I am a sleepy hamster now. Let's play again later!", action: "sleepy" });
  }
  const history = Array.isArray(req.body.history) ? req.body.history : [];
  const clean = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 1000) }));
  // The conversation must start with Ian speaking.
  while (clean.length && clean[0].role !== "user") clean.shift();
  if (!clean.length || clean[clean.length - 1].role !== "user") {
    return res.status(400).json({ error: "Need a message from Ian." });
  }
  try {
    const reply = await chat(loadState(), clean);
    const log = readJson(LOG_FILE, []);
    log.push({ at: new Date().toISOString(), ian: clean[clean.length - 1].text, ginger: reply.say });
    writeJson(LOG_FILE, log.slice(-300));
    res.json(reply);
  } catch (err) {
    console.error("chat failed:", err);
    res.status(502).json({ say: "Oops, my hamster brain is sleepy. Try again!", action: "sleepy", error: errorCode(err) });
  }
});

// Short description of a Claude API error, e.g. "401 authentication_error". Never includes the key.
function errorCode(err) {
  const type = err?.error?.error?.type || err?.name || "error";
  return `${err?.status ?? ""} ${type}`.trim();
}

// ---------- Reading recordings (Ian reads a book aloud; Mom rates it) ----------
const loadReadings = () => readJson(READINGS_FILE, []);
const saveReadings = (list) => writeJson(READINGS_FILE, list);
const AUDIO_EXT = { "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/aac": ".aac", "audio/webm": ".webm", "audio/ogg": ".ogg", "video/mp4": ".m4a", "video/webm": ".webm" };

app.post(
  "/api/reading",
  express.raw({ type: (req) => /^(audio|video)\//.test(req.headers["content-type"] || ""), limit: "60mb" }),
  (req, res) => {
    const mime = (req.headers["content-type"] || "").split(";")[0].trim();
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000 || !AUDIO_EXT[mime]) {
      return res.status(400).json({ error: "no audio" });
    }
    const id = crypto.randomUUID();
    const file = id + AUDIO_EXT[mime];
    fs.writeFileSync(path.join(READINGS_DIR, file), req.body);
    const seconds = Math.max(0, Math.min(1600, Number(req.get("x-duration")) || 0));
    const list = loadReadings();
    list.push({ id, at: new Date().toISOString(), seconds, mime: mime.replace("video/", "audio/"), file, topic: loadState().topic || "", stars: null, comment: "", ratedAt: null });
    // Keep the newest recordings only.
    while (list.length > MAX_READINGS) {
      const old = list.shift();
      fs.rmSync(path.join(READINGS_DIR, path.basename(old.file)), { force: true });
    }
    saveReadings(list);
    res.json({ ok: true, id });
  }
);

// ---------- Voice (Azure Speech) ----------
// Text to speech. Lines are short; the hourly limit below caps spending.
let ttsCount = 0;
let ttsWindow = Date.now();
app.post("/api/tts", async (req, res) => {
  if (!speechEnabled) return res.status(404).json({ error: "voice service not set up" });
  if (Date.now() - ttsWindow > 3600_000) { ttsWindow = Date.now(); ttsCount = 0; }
  if (++ttsCount > 300) return res.status(429).json({ error: "too many" });
  const text = typeof req.body.text === "string" ? req.body.text : "";
  if (!text.trim()) return res.status(400).json({ error: "no text" });
  const voice = typeof req.body.voice === "string" ? req.body.voice : loadState().voice;
  try {
    const audio = await tts(text, voice, TTS_CACHE);
    res.set("Content-Type", "audio/mpeg").send(audio);
  } catch (err) {
    console.error("tts failed:", err.message);
    res.status(502).json({ error: err.message.split(":")[0] });
  }
});

// Speech to text: the page sends a short 16 kHz WAV recording.
app.post("/api/stt", express.raw({ type: "audio/wav", limit: "2mb" }), async (req, res) => {
  if (!speechEnabled) return res.status(404).json({ error: "voice service not set up" });
  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) return res.json({ text: "" });
  try {
    res.json({ text: await stt(req.body) });
  } catch (err) {
    console.error("stt failed:", err.message);
    res.status(502).json({ error: err.message.split(":")[0] });
  }
});

// ---------- Parent side ----------
function requirePin(req, res, next) {
  if (PARENT_PIN && req.get("x-parent-pin") !== PARENT_PIN) {
    return res.status(401).json({ error: "PIN needed" });
  }
  next();
}

const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "text/plain"];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.includes(file.mimetype)),
});

app.get("/api/parent/state", requirePin, (_req, res) => {
  res.json({ ...loadState(), demo: demoMode, pinRequired: Boolean(PARENT_PIN), cloudVoice: speechEnabled, voices: VOICES });
});

app.post("/api/parent/settings", requirePin, (req, res) => {
  const s = loadState();
  if (typeof req.body.topic === "string") s.topic = req.body.topic.slice(0, 500);
  if (typeof req.body.notes === "string") s.notes = req.body.notes.slice(0, 3000);
  if (VOICES.some((v) => v.id === req.body.voice)) s.voice = req.body.voice;
  if ("activeMaterialId" in req.body) {
    const id = req.body.activeMaterialId;
    s.activeMaterialId = s.materials.some((m) => m.id === id) ? id : null;
  }
  saveState(s);
  res.json(s);
});

app.post("/api/parent/upload", requirePin, upload.array("files", 10), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "No supported files (photos, PDF, or .txt)." });
  const added = [];
  for (const file of files) {
    const id = crypto.randomUUID();
    const ext = path.extname(file.originalname) || "";
    fs.writeFileSync(path.join(UPLOAD_DIR, id + ext), file.buffer);
    let text;
    try {
      text = await extractMaterial(file);
    } catch (err) {
      console.error("extract failed:", err);
      text = "(Ginger could not read this file. Try a clearer photo.)";
    }
    added.push({ id, name: file.originalname, type: file.mimetype, file: id + ext, text, addedAt: new Date().toISOString() });
  }
  const s = loadState();
  s.materials.push(...added);
  if (!s.activeMaterialId) s.activeMaterialId = added[0].id;
  saveState(s);
  res.json(s);
});

app.patch("/api/parent/materials/:id", requirePin, (req, res) => {
  const s = loadState();
  const m = s.materials.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Not found" });
  if (typeof req.body.text === "string") m.text = req.body.text.slice(0, 50000);
  if (typeof req.body.name === "string") m.name = req.body.name.slice(0, 200);
  saveState(s);
  res.json(s);
});

app.delete("/api/parent/materials/:id", requirePin, (req, res) => {
  const s = loadState();
  const m = s.materials.find((x) => x.id === req.params.id);
  if (m) fs.rmSync(path.join(UPLOAD_DIR, path.basename(m.file)), { force: true });
  s.materials = s.materials.filter((x) => x.id !== req.params.id);
  if (s.activeMaterialId === req.params.id) s.activeMaterialId = null;
  saveState(s);
  res.json(s);
});

app.get("/api/parent/files/:file", requirePin, (req, res) => {
  res.sendFile(path.join(UPLOAD_DIR, path.basename(req.params.file)));
});

// Lets the parent check that the Claude key works, with one tiny request.
app.post("/api/parent/selftest", requirePin, async (_req, res) => {
  if (demoMode) return res.json({ ok: false, demo: true });
  try {
    const reply = await chat(loadState(), [{ role: "user", text: "Hi Ginger!" }]);
    res.json({ ok: true, say: reply.say });
  } catch (err) {
    console.error("selftest failed:", err);
    res.json({ ok: false, error: errorCode(err), message: String(err?.error?.error?.message || err?.message || "").slice(0, 300) });
  }
});

app.get("/api/parent/readings", requirePin, (_req, res) => {
  res.json(loadReadings().slice().reverse());
});

app.get("/api/parent/readings/:id/audio", requirePin, (req, res) => {
  const r = loadReadings().find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: "Not found" });
  res.type(r.mime).sendFile(path.join(READINGS_DIR, path.basename(r.file)));
});

app.patch("/api/parent/readings/:id", requirePin, (req, res) => {
  const list = loadReadings();
  const r = list.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: "Not found" });
  const stars = Number(req.body.stars);
  if (Number.isInteger(stars) && stars >= 1 && stars <= 5) {
    r.stars = stars;
    r.ratedAt = new Date().toISOString();
  }
  if (typeof req.body.comment === "string") r.comment = req.body.comment.slice(0, 500);
  saveReadings(list);
  res.json(r);
});

app.delete("/api/parent/readings/:id", requirePin, (req, res) => {
  const list = loadReadings();
  const r = list.find((x) => x.id === req.params.id);
  if (r) fs.rmSync(path.join(READINGS_DIR, path.basename(r.file)), { force: true });
  saveReadings(list.filter((x) => x.id !== req.params.id));
  res.json({ ok: true });
});

app.get("/api/parent/chatlog", requirePin, (_req, res) => {
  res.json(readJson(LOG_FILE, []).slice(-100).reverse());
});

app.listen(PORT, () => {
  console.log(`Ginger is awake: http://localhost:${PORT}  (parent page: /parent)`);
  if (demoMode) console.log("Demo mode: set ANTHROPIC_API_KEY for real chat and reading.");
});
