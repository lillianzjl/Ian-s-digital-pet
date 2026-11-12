import * as THREE from "three";
import { Hamster } from "./hamster.js";

// ---------- 3D scene ----------
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

scene.add(new THREE.HemisphereLight(0xfff6e8, 0xe8c9a8, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.radius = 6;
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(2.2, 64),
  new THREE.MeshToonMaterial({ color: 0xbfe3b0 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const pet = new Hamster();
scene.add(pet.root);

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

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  pet.update(clock.getElapsedTime());
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

function speak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = RATE;
    u.pitch = 1.05;
    if (voice) u.voice = voice;
    u.onstart = () => pet.setTalking(true);
    u.onend = u.onerror = () => { pet.setTalking(false); resolve(); };
    speechSynthesis.speak(u);
  });
}

// ---------- Bubbles ----------
const bubble = document.getElementById("bubble");
const ianBubble = document.getElementById("ian-bubble");
let ianTimer;
function petSays(text, action) {
  bubble.textContent = text;
  bubble.hidden = false;
  if (action) pet.play(action);
  return speak(text);
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
      body: JSON.stringify({ history: history.slice(-20) }),
    });
    const reply = await res.json();
    history.push({ role: "assistant", text: reply.say });
    await petSays(reply.say, reply.action);
  } catch {
    await petSays("Oops! I can't hear you right now. Try again!", "sleepy");
  } finally {
    busy = false;
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
  recognizer.onresult = (e) => sendToGinger(e.results[0][0].transcript);
  recognizer.onend = () => micBtn.classList.remove("listening");
  recognizer.onerror = () => micBtn.classList.remove("listening");
}
micBtn.addEventListener("click", () => {
  if (!recognizer) return toggleTypebox(true);
  if (micBtn.classList.contains("listening")) return recognizer.stop();
  speechSynthesis?.cancel();
  pet.setTalking(false);
  micBtn.classList.add("listening");
  try { recognizer.start(); } catch { micBtn.classList.remove("listening"); }
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
    if (what === "seed") petSays(pick(SEED_LINES), "eat");
    else if (what === "dance") petSays(pick(DANCE_LINES), "dance");
    else if (what === "read") sendToGinger("Let's read together!");
    else if (what === "type") toggleTypebox();
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
  if (!hit) return;
  let onHead = false;
  for (let o = hit.object; o; o = o.parent) if (o === pet.head) onHead = true;
  if (onHead) {
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
    const info = await (await fetch("/api/pet")).json();
    const topic = document.getElementById("topic");
    if (info.topic) {
      topic.querySelector("span").textContent = info.topic;
      topic.hidden = false;
    }
    document.getElementById("demo-note").hidden = !info.demo;
  } catch {}
}
loadTopic();

document.getElementById("wake").addEventListener("click", (e) => {
  e.currentTarget.remove();
  // A tap is needed before the browser lets Ginger talk.
  petSays("Hi Ian! I am Ginger. Tap the microphone and talk to me!", "wave");
});
