// Ginger GLB adapter for the existing Ian's Digital Pet website.
// Keeps the existing Hamster API and falls back to the procedural hamster
// until public/models/ginger.glb is added.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Hamster } from "./hamster.js";

const CLIPS = {
  wave: ["Wave", "wave"], jump: ["Jump", "jump"], dance: ["Dance", "dance"],
  wash: ["Wash", "wash", "Groom", "groom"], eat: ["Eat", "eat"],
  nod: ["Nod", "nod"], think: ["Think", "think", "Idle", "idle"],
  happy: ["Celebrate", "celebrate", "Happy", "happy"],
  clap: ["Clap", "clap", "Celebrate", "celebrate"],
  sleepy: ["Sleep", "sleep", "Sleepy", "sleepy"],
  run: ["RunWheel", "runWheel", "Run", "run"],
  talk: ["Talk", "talk"], idle: ["Idle", "idle"]
};
// These keep looping; every other action plays once and then returns to Idle (or Talk).
const LOOPING = new Set(["idle", "talk", "run", "sleepy"]);

export class GingerPet {
  constructor({ modelUrl = "/models/ginger.glb" } = {}) {
    this.root = new THREE.Group();
    this.placeholder = new Hamster();
    this.root.add(this.placeholder.root);
    this.mixer = null;
    this.actions = new Map();
    this.currentAction = null;
    this.modelReady = false;
    this.talking = false;
    this.look = new THREE.Vector2();
    this._lastTime = null;
    this.loadModel(modelUrl);
  }

  async loadModel(url) {
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = 2.5 / Math.max(size.x, size.y, size.z, 0.001);
      model.scale.setScalar(scale);
      model.position.sub(center.multiplyScalar(scale));
      const normalized = new THREE.Box3().setFromObject(model);
      model.position.y -= normalized.min.y;
      model.traverse((obj) => {
        if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
      });
      this.root.remove(this.placeholder.root);
      this.root.add(model);
      this.model = model;
      this.mixer = new THREE.AnimationMixer(model);
      this.mixer.addEventListener("finished", () => this.play(this.talking ? "talk" : "idle"));
      for (const clip of gltf.animations || []) {
        this.actions.set(clip.name.toLowerCase(), this.mixer.clipAction(clip));
      }
      this.modelReady = true;
      this.play(this.talking ? "talk" : "idle");
      console.info("[Ginger] GLB model loaded.");
    } catch (err) {
      // Expected until the artist's GLB is delivered. Keep the site functional.
      console.info("[Ginger] GLB not found yet; using existing procedural hamster.");
    }
  }

  findAction(name) {
    for (const candidate of (CLIPS[name] || [name])) {
      const action = this.actions.get(candidate.toLowerCase());
      if (action) return action;
    }
    return null;
  }

  play(name) {
    if (!this.modelReady) { this.placeholder.play(name); return; }
    const action = this.findAction(name);
    if (!action) return;
    if (this.currentAction && this.currentAction !== action) this.currentAction.fadeOut(0.18);
    if (LOOPING.has(name)) {
      action.setLoop(THREE.LoopRepeat, Infinity);
    } else {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    action.reset().fadeIn(0.18).play();
    this.currentAction = action;
  }

  setTalking(on) {
    this.talking = Boolean(on);
    if (!this.modelReady) { this.placeholder.setTalking(this.talking); return; }
    // Don't cut off a one-time action (wave, eat…); it returns to Talk/Idle when it finishes.
    const busy = this.currentAction && this.currentAction.loop === THREE.LoopOnce && this.currentAction.isRunning();
    if (!busy) this.play(this.talking ? "talk" : "idle");
  }

  // Did a tap (a raycast hit) land on the head? Used for head pats.
  isHeadHit(hit) {
    if (!this.modelReady) {
      for (let o = hit.object; o; o = o.parent) if (o === this.placeholder.head) return true;
      return false;
    }
    // Skinned meshes are hit as one mesh, so judge by height: Ginger's head is the top ~45%.
    const box = new THREE.Box3().setFromObject(this.model);
    return hit.point.y > box.min.y + (box.max.y - box.min.y) * 0.55;
  }

  lookToward(x, y) {
    this.look.set(x, y);
    if (!this.modelReady) { this.placeholder.lookToward(x, y); return; }
    const head = this.model.getObjectByName("Head") || this.model.getObjectByName("head");
    if (head) {
      head.rotation.y = THREE.MathUtils.clamp(x * 0.22, -0.25, 0.25);
      head.rotation.x = THREE.MathUtils.clamp(-y * 0.12, -0.15, 0.15);
    }
  }

  update(t) {
    if (!this.modelReady) { this.placeholder.update(t); return; }
    const delta = this._lastTime == null ? 0 : Math.max(0, Math.min(0.05, t - this._lastTime));
    this._lastTime = t;
    this.mixer?.update(delta);
  }
}
