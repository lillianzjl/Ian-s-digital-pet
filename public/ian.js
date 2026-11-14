import * as THREE from "three";
import { GingerPet } from "./ginger-pet.js";
import { GlbHamster, GINGER_V7 } from "./glb-hamster.js";
import { setFur } from "./hamster.js";
import { openMic, startBookRecording, stopBookRecording, MAX_SECONDS } from "./reading.js";
import {
  unlockAudio, stopAudio, cloudSpeak, startRecording, stopRecording, isRecording,
} from "./cloudvoice.js";

// Settings from the server, e.g. whether the cloud voice (Azure) is set up.
const petInfo = fetch("/api/pet").then((r) => r.json()).catch(() => ({}));
let cloudVoiceOn = false; // known without waiting, so taps stay "user gestures" on iPhone
petInfo.then((info) => (cloudVoiceOn = Boolean(info.cloudVoice)));

// ---------- 3D scene ----------
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

// Soft, warm lighting with a rim light behind so the fur edges glow.
scene.add(new THREE.HemisphereLight(0xfff3f6, 0xf3d6b8, 1.4));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
sun.position.set(3, 6, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.radius = 6;
scene.add(sun);
const rim = new THREE.DirectionalLight(0xffd9e6, 2.2);
rim.position.set(-3, 4, -5);
scene.add(rim);
const fill = new THREE.DirectionalLight(0xdfefff, 0.6);
fill.position.set(-4, 2, 4);
scene.add(fill);

// Wood-shavings bedding
function beddingTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#f3dfbf";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1400; i++) {
    const shade = 200 + Math.random() * 50;
    g.strokeStyle = `rgba(${shade + 10}, ${shade - 15}, ${shade - 60}, ${0.4 + Math.random() * 0.5})`;
    g.lineWidth = 2 + Math.random() * 4;
    g.beginPath();
    const x = Math.random() * 512, y = Math.random() * 512, a = Math.random() * Math.PI, l = 8 + Math.random() * 22;
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 4, y + Math.sin(a) * l * 0.5 - 4, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(3.2, 64),
  new THREE.MeshStandardMaterial({ map: beddingTexture(), roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Pink exercise wheel behind Ginger. Wide enough for her to run in it.
const wheel = new THREE.Group(); // placement
const wheelSpin = new THREE.Group(); // turns while Ginger runs
wheel.add(wheelSpin);
const wheelMat = new THREE.MeshPhysicalMaterial({ color: 0xf6b3c8, roughness: 0.35, clearcoat: 0.6 });
const R = 2.3;
const WHEEL_WIDTH = 2.0;
for (const z of [-WHEEL_WIDTH / 2, WHEEL_WIDTH / 2]) {
  const rimMesh = new THREE.Mesh(new THREE.TorusGeometry(R, 0.07, 16, 96), wheelMat);
  rimMesh.position.z = z;
  wheelSpin.add(rimMesh);
}
for (let i = 0; i < 48; i++) {
  const a = (i / 48) * Math.PI * 2;
  const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, WHEEL_WIDTH, 8), wheelMat);
  rung.rotation.x = Math.PI / 2;
  rung.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
  wheelSpin.add(rung);
}
// Hub and spokes on the back side, so the turning is easy to see.
const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 24), wheelMat);
hub.rotation.x = Math.PI / 2;
hub.position.z = -WHEEL_WIDTH / 2;
wheelSpin.add(hub);
for (let i = 0; i < 6; i++) {
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(R * 2, 0.09, 0.06), wheelMat);
  spoke.rotation.z = (i / 6) * Math.PI;
  spoke.position.z = -WHEEL_WIDTH / 2;
  wheelSpin.add(spoke);
}
wheel.position.set(0.4, R + 0.05, -2.8);
wheel.rotation.y = -0.35;
scene.add(wheel);

// Seed bowl
const bowl = new THREE.Group();
bowl.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.38, 0.25, 40, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, clearcoat: 1, side: THREE.DoubleSide })));
const seedColors = [0x2f2f2f, 0xe8d6a8, 0xd9a85b, 0x7a5a3a];
for (let i = 0; i < 26; i++) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: seedColors[i % 4], roughness: 0.6 }));
  const a = Math.random() * Math.PI * 2, r = Math.random() * 0.38;
  s.position.set(Math.cos(a) * r, 0.1 + Math.random() * 0.05, Math.sin(a) * r);
  s.scale.set(0.7, 0.6, 1.3);
  s.rotation.y = Math.random() * 3;
  bowl.add(s);
}
bowl.position.set(-1.9, 0.12, 0.9);
bowl.traverse((o) => (o.castShadow = true));
scene.add(bowl);

// Preview of the v7 3D model: open the page with ?pet=v7. Without it, Ian sees the usual Ginger.
const previewModel = new URLSearchParams(location.search).get("pet");
// Preview without fur: ?fur=off
if (new URLSearchParams(location.search).get("fur") === "off") setFur(false);
const pet = previewModel === "v7" ? new GlbHamster(GINGER_V7) : new GingerPet();
// An outer group carries Ginger around (into the wheel and back); her own
// animations move pet.root inside it.
const petHolder = new THREE.Group();
petHolder.add(pet.root);
scene.add(petHolder);
window.__pet = pet; // handy for debugging in the browser console

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Keep the whole hamster in view on tall phones and wide screens alike.
  const portrait = w / h < 0.8;
  // Leave room above the head for the speech bubble.
  camera.position.set(0, portrait ? 2.2 : 1.9, portrait ? 11 : 8);
  camera.lookAt(0, portrait ? 2.0 : 1.75, 0);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- Running in the wheel ----------
// Hop in, run while the wheel turns, hop back out.
const HOP_IN = 0.9;
const RUN = 4.5; // same length as the hamster's "run" action
const HOP_OUT = 0.9;
const home = new THREE.Vector3(0, 0, 0);
const inWheel = new THREE.Vector3(wheel.position.x, 0.08, wheel.position.z);
// Face along the wheel, so she runs "forward" as the bottom of the wheel moves back.
const runDir = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), wheel.rotation.y);
const runYaw = Math.atan2(runDir.x, runDir.z);
let wheelRun = null; // { start } while running

function startWheelRun(t) {
  if (wheelRun) return;
  wheelRun = { start: t, running: false };
  petSays("Wheee! Watch me run!");
}

function hop(from, to, yawFrom, yawTo, u) {
  const e = u * u * (3 - 2 * u); // ease in and out
  petHolder.position.lerpVectors(from, to, e);
  petHolder.position.y += Math.sin(Math.PI * u) * 1.3;
  petHolder.rotation.y = yawFrom + (yawTo - yawFrom) * e;
}

function updateWheelRun(t, dt) {
  if (!wheelRun) return;
  const s = t - wheelRun.start;
  if (s < HOP_IN) {
    hop(home, inWheel, 0, runYaw, s / HOP_IN);
  } else if (s < HOP_IN + RUN) {
    if (!wheelRun.running) {
      wheelRun.running = true;
      petHolder.position.copy(inWheel);
      petHolder.rotation.y = runYaw;
      pet.play("run");
    }
    const p = (s - HOP_IN) / RUN;
    const speed = Math.min(1, p * 6, (1 - p) * 6);
    wheelSpin.rotation.z -= 4.5 * speed * dt; // the bottom moves back under her feet
  } else if (s < HOP_IN + RUN + HOP_OUT) {
    hop(inWheel, home, runYaw, 0, (s - HOP_IN - RUN) / HOP_OUT);
  } else {
    petHolder.position.copy(home);
    petHolder.rotation.y = 0;
    wheelRun = null;
    petSays("That was fun! Let's run again!", "happy");
  }
}

// ---------- Clean-up time: brush teeth, take a bath, wash face ----------
const tub = new THREE.Group();
{
  const white = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.25, clearcoat: 1, side: THREE.DoubleSide });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.1, 0.85, 48, 1, true), white);
  shell.position.y = 0.42;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), white);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.02;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.07, 12, 64), white);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.85;
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(1.28, 48),
    new THREE.MeshPhysicalMaterial({ color: 0x9fdcff, roughness: 0.1, transparent: true, opacity: 0.75 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.7;
  tub.add(shell, bottom, rim, water);
  // A pile of foam floating on the water.
  const foamMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0.95 });
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.75 + Math.random() * 0.45;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.1 + Math.random() * 0.1, 12, 10), foamMat);
    b.position.set(Math.cos(a) * r, 0.74, Math.sin(a) * r);
    tub.add(b);
  }
}
tub.scale.setScalar(0.001);
tub.visible = false;
scene.add(tub);

// Soap bubbles that float up and pop.
const bubbleMat = new THREE.MeshPhysicalMaterial({ color: 0xdff4ff, roughness: 0.05, transparent: true, opacity: 0.55, clearcoat: 1 });
const bubbles = Array.from({ length: 22 }, () => {
  const b = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), bubbleMat.clone());
  b.visible = false;
  scene.add(b);
  return b;
});
function spawnBubble(t) {
  const b = bubbles.find((x) => !x.visible);
  if (!b) return;
  const a = Math.random() * Math.PI * 2;
  b.userData = { born: t, x: Math.cos(a) * (0.6 + Math.random() * 0.6), z: Math.sin(a) * 0.9, size: 0.06 + Math.random() * 0.1, speed: 0.6 + Math.random() * 0.6 };
  b.visible = true;
}
function updateBubbles(t) {
  for (const b of bubbles) {
    if (!b.visible) continue;
    const { born, x, z, size, speed } = b.userData;
    const age = t - born;
    if (age > 2.4) {
      b.visible = false;
      continue;
    }
    b.position.set(x + Math.sin(age * 3 + x * 5) * 0.12, 0.75 + age * speed, z);
    b.scale.setScalar(size * (1 + age * 0.2));
    b.material.opacity = 0.55 * (1 - age / 2.4);
  }
}

function sparkles() {
  const rect = canvas.getBoundingClientRect();
  for (let i = 0; i < 10; i++) {
    const s = document.createElement("span");
    s.textContent = "✨";
    s.style.left = `${rect.width / 2 + (Math.random() - 0.5) * 220}px`;
    s.style.top = `${rect.height * 0.55 + (Math.random() - 0.5) * 200}px`;
    s.style.animationDelay = `${i * 0.07}s`;
    heartsLayer.append(s);
    setTimeout(() => s.remove(), 2000);
  }
}

let cleanRun = null; // { start, step } while cleaning
const CLEAN_STEPS = [
  { at: 0, run: () => { pet.play("brush"); petSays("Brush, brush, brush! Clean teeth!"); } },
  { at: 3.6, run: () => { tub.visible = true; pet.play("bathe"); petSays("Bath time! Splish, splash!"); } },
  { at: 7.4, run: () => { pet.play("wash"); petSays("Now I wash my face."); } },
  { at: 10.0, run: () => { pet.play("happy"); sparkles(); petSays("All clean! I feel so fresh!"); } },
];
const CLEAN_END = 11.8;

function startCleanRun(t) {
  if (cleanRun) return;
  cleanRun = { start: t, step: 0 };
}

function updateCleanRun(t) {
  updateBubbles(t);
  if (!cleanRun) return;
  const s = t - cleanRun.start;
  while (cleanRun.step < CLEAN_STEPS.length && s >= CLEAN_STEPS[cleanRun.step].at) CLEAN_STEPS[cleanRun.step++].run();
  // The tub pops up for the bath, then shrinks away.
  const bathIn = 3.6, bathOut = 7.4;
  let k = 0;
  if (s >= bathIn && s < bathOut) k = Math.min(1, (s - bathIn) / 0.35);
  else if (s >= bathOut) k = Math.max(0, 1 - (s - bathOut) / 0.35);
  tub.scale.setScalar(Math.max(0.001, k < 1 ? k * (1.15 - 0.15 * k) : 1));
  tub.visible = k > 0;
  if (s >= bathIn && s < bathOut - 0.3 && Math.random() < 0.25) spawnBubble(t);
  if (s >= CLEAN_END) cleanRun = null;
}

// ---------- Reading time: Ian reads a book aloud, Mom rates it later ----------
let readingActive = false;
const readingPanel = document.getElementById("reading");
const readingElapsed = document.getElementById("reading-elapsed");
const readingProgress = document.getElementById("reading-progress");
const readingStop = document.getElementById("reading-stop");
const controls = document.getElementById("controls");
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

async function startReadingTime() {
  if (readingActive) return;
  // Ask for the microphone right now, during the tap — iPhone refuses it a few seconds later.
  const micPromise = openMic();
  micPromise.catch(() => {}); // handled in startBookRecording
  readingActive = true;
  if (isRecording()) stopRecording();
  // Say this first, so Ginger's voice is not on the recording.
  await petSays("Let's read a book! I'm listening.", "nod");
  readingElapsed.textContent = "0:00";
  readingProgress.style.width = "0%";
  readingStop.disabled = false;
  readingStop.textContent = "⏹ I'm done!";
  controls.hidden = true;
  bubble.hidden = true;
  readingPanel.hidden = false;
  // Ginger nods along quietly while Ian reads.
  const nodder = setInterval(() => pet.play(Math.random() < 0.5 ? "nod" : "happy"), 12000);
  const ok = await startBookRecording({
    micPromise,
    onTick: (sec) => {
      readingElapsed.textContent = fmt(sec);
      readingProgress.style.width = `${Math.min(100, (sec / MAX_SECONDS) * 100)}%`;
    },
    onFinish: ({ seconds, saved, error }) => {
      clearInterval(nodder);
      readingPanel.hidden = true;
      controls.hidden = false;
      readingActive = false;
      if (saved) {
        const m = Math.round(seconds / 60);
        const howLong = m >= 2 ? ` You read for ${m} minutes!` : m === 1 ? " You read for one minute!" : "";
        petSays(`Great reading, Ian!${howLong} Mom will listen and give you stars!`, "clap");
      } else if (error === "too short") {
        petSays("That was very short. Let's read a little longer next time!", "think");
      } else {
        showDebug(`reading: ${error}`);
        petSays(error?.startsWith("mic:") ? "My ears are turned off. Ask a grown-up to let me use the microphone." : "Oops, I could not save it. Let's try again!", "think");
      }
    },
  });
  if (!ok) readingStop.disabled = true;
}

readingStop.addEventListener("click", () => {
  readingStop.disabled = true;
  readingStop.textContent = "Saving…";
  stopBookRecording();
});

// When Mom has rated a reading Ian hasn't heard about yet, Ginger tells him.
async function announceRating() {
  const info = await petInfo;
  const r = info.latestRating;
  if (!r) return;
  let seen = "";
  try { seen = localStorage.getItem("ginger-seen-rating") || ""; } catch {}
  const key = `${r.id}:${r.ratedAt}`;
  if (seen === key) return;
  try { localStorage.setItem("ginger-seen-rating", key); } catch {}
  const words = ["", "one star", "two stars", "three stars", "four stars", "five stars"][r.stars] || `${r.stars} stars`;
  const line = `Guess what? Mom gave your reading ${words}!`;
  await petSays(`${line} ${"⭐".repeat(r.stars)}`, "happy", line);
}

// Something big is happening (running, cleaning, reading): other buttons wait.
const busyScene = () => Boolean(wheelRun || cleanRun || readingActive);

const clock = new THREE.Clock();
let lastT = 0;
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  const dt = Math.min(0.1, t - lastT);
  lastT = t;
  updateWheelRun(t, dt);
  updateCleanRun(t);
  pet.update(t);
  renderer.render(scene, camera);
});

// ---------- Voice (American English, male, rate 0.85) ----------
const RATE = 0.85;
const MALE_HINTS = ["andrew", "brian", "guy", "christopher", "eric", "roger", "steffan", "davis", "jason", "tony",
  "aaron", "evan", "nathan", "tom", "alex", "fred", "david", "mark", "ryan", "junior", "ralph", "bruce", "male"];
const voiceSelect = document.getElementById("voice");
let voice = null;

function usVoices() {
  return speechSynthesis.getVoices().filter((v) => v.lang.replace("_", "-").toLowerCase() === "en-us");
}
function scoreVoice(v) {
  const name = v.name.toLowerCase();
  let score = 0;
  if (MALE_HINTS.some((h) => name.includes(h))) score += 10;
  if (name.includes("natural") || name.includes("online") || name.includes("enhanced") || name.includes("premium")) score += 3;
  if (name.includes("female") || name.includes("samantha") || name.includes("zira") || name.includes("aria")) score -= 20;
  return score;
}
function loadVoices() {
  const voices = usVoices().sort((a, b) => scoreVoice(b) - scoreVoice(a));
  if (!voices.length) return;
  let saved = null;
  try { saved = localStorage.getItem("ginger-voice"); } catch {}
  voiceSelect.innerHTML = "";
  for (const v of voices) {
    const opt = document.createElement("option");
    opt.value = v.name;
    opt.textContent = v.name;
    voiceSelect.append(opt);
  }
  voice = voices.find((v) => v.name === saved) || voices[0];
  voiceSelect.value = voice.name;
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.addEventListener("voiceschanged", loadVoices);
}
voiceSelect.addEventListener("change", () => {
  voice = usVoices().find((v) => v.name === voiceSelect.value) || voice;
  try { localStorage.setItem("ginger-voice", voice.name); } catch {}
});

// A small grey line at the bottom that tells a grown-up what went wrong.
const debugLine = document.getElementById("debug");
function showDebug(msg) {
  debugLine.textContent = msg;
  debugLine.hidden = !msg;
}

// iPhone Safari quirks: calling cancel() right before speak() can drop the new
// utterance, and an utterance with no live reference may be garbage-collected mid-speech.
let currentUtterance = null;
function browserSpeak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    speechSynthesis.resume();
    const u = new SpeechSynthesisUtterance(text);
    currentUtterance = u;
    u.lang = "en-US";
    u.rate = RATE;
    u.pitch = 1.05;
    if (voice) u.voice = voice;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pet.setTalking(false);
      resolve();
    };
    u.onstart = () => pet.setTalking(true);
    u.onend = finish;
    u.onerror = (e) => { showDebug(`voice: ${e.error || "error"}`); finish(); };
    // Safety net: some phones never report the end of speech (or never start it).
    const words = text.split(/\s+/).length;
    setTimeout(finish, 2500 + (words / 2.5) * (1000 / RATE));
    speechSynthesis.speak(u);
  });
}

// Uses the cloud voice when it is set up, otherwise the phone's own voice.
async function speak(text) {
  const info = await petInfo;
  if (!info.cloudVoice) return browserSpeak(text);
  try {
    await cloudSpeak(text, { onStart: () => pet.setTalking(true), onError: showDebug });
  } catch (err) {
    showDebug(err.message);
  } finally {
    pet.setTalking(false);
  }
}

// ---------- Bubbles ----------
const bubble = document.getElementById("bubble");
const ianBubble = document.getElementById("ian-bubble");
let ianTimer;
// spoken: what the voice says, if different from the bubble (e.g. without emoji).
function petSays(text, action, spoken = text) {
  bubble.textContent = text;
  bubble.hidden = false;
  if (action) pet.play(action);
  return speak(spoken);
}
function ianSaid(text) {
  ianBubble.textContent = text;
  ianBubble.hidden = false;
  clearTimeout(ianTimer);
  ianTimer = setTimeout(() => (ianBubble.hidden = true), 6000);
}

// ---------- Talking to Claude ----------
const history = [];
let busy = false;
async function sendToGinger(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  ianSaid(text);
  history.push({ role: "user", text });
  pet.play("think");
  bubble.textContent = "…";
  bubble.hidden = false;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history: history.slice(-12) }),
    });
    const reply = await res.json();
    showDebug(reply.error ? `chat: ${reply.error}` : "");
    if (res.ok) history.push({ role: "assistant", text: reply.say });
    busy = false;
    return petSays(reply.say || "Squeak?", reply.action);
  } catch (err) {
    busy = false;
    showDebug(`network: ${err.message}`);
    return petSays("Oops! I can't hear you right now. Try again!", "sleepy");
  }
}

// ---------- Microphone (speech to text, American English) ----------
const micBtn = document.getElementById("mic");
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
if (Recognition) {
  recognizer = new Recognition();
  recognizer.lang = "en-US";
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;
  let heard = false;
  recognizer.onstart = () => { heard = false; };
  recognizer.onresult = (e) => {
    heard = true;
    sendToGinger(e.results[0][0].transcript);
  };
  recognizer.onend = () => {
    micBtn.classList.remove("listening");
    if (!heard && !busy) petSays("I didn't hear you. Tap the microphone and try again!", "think");
  };
  recognizer.onerror = (e) => {
    heard = true; // the error message below is enough
    micBtn.classList.remove("listening");
    showDebug(`mic: ${e.error}`);
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      petSays("My ears are turned off. Ask a grown-up to let me use the microphone.", "think");
    } else if (e.error === "no-speech") {
      petSays("I didn't hear anything. Try again!", "think");
    }
  };
}
async function cloudMic() {
  if (isRecording()) return stopRecording();
  stopAudio();
  pet.setTalking(false);
  micBtn.classList.add("warming"); // mic is starting; not recording yet
  const ok = await startRecording({
    onReady: () => {
      micBtn.classList.remove("warming");
      micBtn.classList.add("listening");
      bubble.textContent = "I'm listening! 👂";
      bubble.hidden = false;
    },
    onStopping: () => {
      micBtn.classList.remove("listening", "warming");
      bubble.textContent = "…";
      pet.play("think");
    },
    onDone: (text) => {
      if (text) sendToGinger(text);
      else if (!busy) petSays("I didn't hear you. Tap the microphone and try again!", "think");
    },
    onError: (msg) => {
      showDebug(msg);
      if (msg.startsWith("mic:")) petSays("My ears are turned off. Ask a grown-up to let me use the microphone.", "think");
    },
  });
  if (!ok) micBtn.classList.remove("listening", "warming");
}

micBtn.addEventListener("click", () => {
  if (cloudVoiceOn) return cloudMic();
  if (!recognizer) return toggleTypebox(true);
  if (micBtn.classList.contains("listening")) return recognizer.stop();
  speechSynthesis?.cancel();
  pet.setTalking(false);
  micBtn.classList.add("listening");
  try {
    recognizer.start();
  } catch (err) {
    micBtn.classList.remove("listening");
    showDebug(`mic: ${err.message}`);
  }
});

// ---------- Typing (for devices without a microphone) ----------
const typebox = document.getElementById("typebox");
const typed = document.getElementById("typed");
function toggleTypebox(show = typebox.hidden) {
  typebox.hidden = !show;
  if (show) typed.focus();
}
typebox.addEventListener("submit", (e) => {
  e.preventDefault();
  sendToGinger(typed.value);
  typed.value = "";
});

// ---------- Fun buttons ----------
const SEED_LINES = ["Yum! Sunflower seeds are my favorite!", "Crunch crunch! Thank you, Ian!", "Mmm! My cheeks are so full!"];
const DANCE_LINES = ["Let's dance! Wiggle wiggle!", "Spin with me, Ian!", "I love to dance!"];
const PET_LINES = ["Hee hee! That tickles!", "I love head pats!", "You are so kind, Ian!"];
const POKE_LINES = ["Boing! Boing!", "Look at me jump!", "Squeak! You found me!"];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

document.querySelectorAll(".fun-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    const what = btn.dataset.do;
    if (busyScene()) return; // running, cleaning or reading
    if (what === "wheel") return startWheelRun(clock.getElapsedTime());
    if (what === "clean") return startCleanRun(clock.getElapsedTime());
    if (what === "record") return startReadingTime();
    if (what === "seed") petSays(pick(SEED_LINES), "eat");
    else if (what === "dance") petSays(pick(DANCE_LINES), "dance");
    else if (what === "read") sendToGinger("Let's read together!");
  })
);

// ---------- Touching the hamster ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const heartsLayer = document.getElementById("hearts");
function hearts(x, y) {
  for (let i = 0; i < 5; i++) {
    const h = document.createElement("span");
    h.textContent = "💗";
    h.style.left = `${x + (Math.random() - 0.5) * 80}px`;
    h.style.top = `${y}px`;
    h.style.animationDelay = `${i * 0.08}s`;
    heartsLayer.append(h);
    setTimeout(() => h.remove(), 1800);
  }
}
canvas.addEventListener("pointermove", (e) => {
  pet.lookToward((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
});
canvas.addEventListener("pointerdown", (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(pet.root, true)[0];
  if (!hit || busyScene()) return;
  if (pet.isHeadHit(hit)) {
    hearts(e.clientX, e.clientY);
    petSays(pick(PET_LINES), "happy");
  } else {
    petSays(pick(POKE_LINES), pick(["jump", "wash", "clap"]));
  }
});

// ---------- Settings ----------
const settings = document.getElementById("settings");
document.getElementById("gear").addEventListener("click", () => (settings.hidden = false));
document.getElementById("close-settings").addEventListener("click", () => (settings.hidden = true));
document.getElementById("test-voice").addEventListener("click", () => petSays("Hi Ian! Do you like my voice?", "wave"));

// ---------- Start ----------
async function loadTopic() {
  try {
    const info = await petInfo;
    const topic = document.getElementById("topic");
    if (info.topic) {
      topic.querySelector("span").textContent = info.topic;
      topic.hidden = false;
    }
    document.getElementById("demo-note").hidden = !info.demo;
    if (info.cloudVoice) {
      voiceSelect.hidden = true;
      document.querySelector("#settings .hint").textContent = "Ginger's voice is chosen on the parent page. Speed is set to 0.85.";
    }
  } catch {}
}
loadTopic();

document.getElementById("wake").addEventListener("click", (e) => {
  e.currentTarget.remove();
  // A tap is needed before the browser lets Ginger talk.
  unlockAudio();
  petSays("Hi Ian! I am Ginger. Tap the microphone and talk to me!", "wave").then(announceRating);
});
