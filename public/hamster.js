// Peanut: a standing 3D hamster built from simple shapes, with procedural animations.
import * as THREE from "three";

// Colors match Ian's real hamster: a cream Syrian with a light apricot back,
// white belly and cheeks, big thin pink ears, pink nose and paws.
const COLORS = {
  fur: 0xf3d3a6,
  cream: 0xfffaf2,
  pink: 0xf7b2b8,
  ear: 0xf2c3b5,
  dark: 0x2b1d14,
  mouth: 0x8a3b3b,
  seed: 0x3a3a3a,
};

function toonGradient() {
  const data = new Uint8Array([90, 170, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export class Hamster {
  constructor() {
    const gradientMap = toonGradient();
    const mat = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap, ...extra });
    const ball = (r, color, pos, scale = [1, 1, 1], extra) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), mat(color, extra));
      m.position.set(...pos);
      m.scale.set(...scale);
      m.castShadow = true;
      return m;
    };

    this.root = new THREE.Group();
    this.parts = [];

    // Body and belly
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.body.add(ball(0.72, COLORS.fur, [0, 0.85, 0], [1, 1.1, 0.95]));
    this.body.add(ball(0.56, COLORS.cream, [0, 0.8, 0.36], [1, 1.12, 0.62]));
    this.body.add(ball(0.13, COLORS.cream, [0, 0.35, -0.68])); // tail

    // Feet
    for (const s of [-1, 1]) {
      this.body.add(ball(0.2, COLORS.pink, [0.3 * s, 0.08, 0.28], [1, 0.45, 1.5]));
    }

    // Head (pivot at the neck so nods and tilts look natural)
    this.head = new THREE.Group();
    this.head.position.set(0, 1.45, 0);
    this.body.add(this.head);
    this.head.add(ball(0.74, COLORS.fur, [0, 0.5, 0], [1.1, 0.95, 1]));
    this.head.add(ball(0.32, COLORS.cream, [0, 0.33, 0.48], [1.25, 0.85, 0.8])); // muzzle
    this.cheeks = [];
    for (const s of [-1, 1]) {
      const cheek = ball(0.24, COLORS.cream, [0.4 * s, 0.3, 0.36], [1, 0.9, 0.8]);
      this.cheeks.push(cheek);
      this.head.add(cheek);
      const blush = ball(0.11, COLORS.pink, [0.46 * s, 0.4, 0.56], [1, 0.6, 0.3], { transparent: true, opacity: 0.85 });
      this.head.add(blush);
    }
    this.head.add(ball(0.075, COLORS.pink, [0, 0.47, 0.83], [1.3, 1, 1])); // nose
    this.mouth = ball(0.07, COLORS.mouth, [0, 0.27, 0.77], [1.5, 0.35, 0.5]);
    this.head.add(this.mouth);

    // Eyes with sparkles
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(0.29 * s, 0.6, 0.62);
      eye.add(ball(0.11, COLORS.dark, [0, 0, 0], [1, 1.15, 0.7], { gradientMap: null }));
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      shine.position.set(0.035 * s, 0.045, 0.07);
      eye.add(shine);
      this.eyes.push(eye);
      this.head.add(eye);
    }

    // Ears
    this.ears = [];
    for (const s of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(0.5 * s, 1.12, -0.05);
      ear.userData.baseZ = -0.35 * s;
      ear.add(ball(0.3, COLORS.ear, [0, 0, 0], [1, 1.05, 0.35]));
      ear.add(ball(0.22, COLORS.pink, [0, 0, 0.07], [1, 1.05, 0.25]));
      this.ears.push(ear);
      this.head.add(ear);
    }

    // Arms (pivot at the shoulder, hanging down)
    this.arms = [];
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(0.56 * s, 1.25, 0.18);
      const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.3, 8, 16), mat(COLORS.fur));
      limb.position.y = -0.22;
      limb.castShadow = true;
      arm.add(limb);
      arm.add(ball(0.12, COLORS.pink, [0, -0.45, 0.02]));
      this.arms.push(arm);
      this.body.add(arm);
    }

    // Sunflower seed held when eating
    this.seed = ball(0.09, COLORS.seed, [0, -0.5, 0.12], [0.7, 1.4, 0.5]);
    this.seed.visible = false;
    this.arms[1].add(this.seed);

    this.action = null;
    this.actionStart = 0;
    this.talking = false;
    this.nextBlink = 2;
    this.look = new THREE.Vector2();
  }

  play(name) {
    const durations = { wave: 2, jump: 1.4, dance: 2.8, wash: 2.4, eat: 2.6, nod: 1.2, think: 2.2, happy: 1.8, clap: 1.8, sleepy: 3 };
    if (!durations[name]) return;
    this.action = name;
    this.actionDuration = durations[name];
    this.actionStart = this.time ?? 0;
  }

  setTalking(on) {
    this.talking = on;
  }

  lookToward(x, y) {
    this.look.set(x, y);
  }

  update(t) {
    this.time = t;
    const [armL, armR] = this.arms;

    // Base pose: gentle breathing, soft sway, follow the pointer with the head
    this.root.position.y = 0;
    this.root.rotation.set(0, 0, 0);
    this.body.scale.set(1, 1 + Math.sin(t * 2.2) * 0.012, 1);
    this.body.rotation.z = Math.sin(t * 0.9) * 0.025;
    this.head.rotation.set(-this.look.y * 0.18, this.look.x * 0.35, Math.sin(t * 0.7) * 0.04);
    armL.rotation.set(0.1, 0, -0.18 - Math.sin(t * 2.2) * 0.03);
    armR.rotation.set(0.1, 0, 0.18 + Math.sin(t * 2.2) * 0.03);
    for (const ear of this.ears) ear.rotation.set(0, 0, ear.userData.baseZ);
    for (const c of this.cheeks) c.scale.setScalar(1);
    this.seed.visible = false;
    let eyeOpen = 1;
    let mouthOpen = this.talking ? 0.35 + Math.abs(Math.sin(t * 14)) * 1.6 : 0.35;

    // Blinking
    if (t > this.nextBlink) {
      const k = (t - this.nextBlink) / 0.15;
      eyeOpen = k < 1 ? Math.abs(1 - 2 * k) : 1;
      if (k >= 1) this.nextBlink = t + 2 + Math.random() * 3;
    }

    // Current action layered on top
    if (this.action) {
      const p = (t - this.actionStart) / this.actionDuration;
      if (p >= 1) {
        this.action = null;
      } else {
        const env = Math.sin(Math.PI * Math.min(1, p * 1.0)); // ease in/out 0..1..0
        const a = this.action;
        if (a === "wave") {
          armR.rotation.z = 0.18 + env * 2.5;
          armR.rotation.x = -0.2 * env;
          armR.rotation.y = Math.sin(t * 12) * 0.5 * env;
          this.head.rotation.z += 0.15 * env;
        } else if (a === "jump") {
          const hop = (p * 2) % 1;
          this.root.position.y = Math.sin(Math.PI * hop) * 0.55;
          const squash = hop < 0.12 || hop > 0.9 ? 0.9 : 1.04;
          this.body.scale.set(2 - squash, squash, 2 - squash);
          armL.rotation.z = -0.18 - 1.6 * Math.sin(Math.PI * hop);
          armR.rotation.z = 0.18 + 1.6 * Math.sin(Math.PI * hop);
        } else if (a === "dance") {
          this.root.rotation.y = p < 0.5 ? 0 : (p - 0.5) * 2 * Math.PI * 2;
          this.body.rotation.z = Math.sin(t * 8) * 0.18 * env;
          armL.rotation.z = -0.4 - (Math.sin(t * 8) * 0.5 + 0.9) * env;
          armR.rotation.z = 0.4 + (Math.sin(t * 8 + Math.PI) * 0.5 + 0.9) * env;
          this.root.position.y = Math.abs(Math.sin(t * 8)) * 0.12 * env;
          eyeOpen = Math.min(eyeOpen, 0.35);
        } else if (a === "wash") {
          const rub = Math.sin(t * 10) * 0.18;
          armL.rotation.set(-2.2 * env, 0, 0.55 * env + rub * env);
          armR.rotation.set(-2.2 * env, 0, -0.55 * env - rub * env);
          this.head.rotation.x += 0.15 * env;
          eyeOpen = Math.min(eyeOpen, 1 - env);
        } else if (a === "eat") {
          this.seed.visible = p > 0.05 && p < 0.85;
          armR.rotation.set(-2.0 * env, 0, -0.5 * env);
          armL.rotation.set(-1.7 * env, 0, 0.45 * env);
          const chew = Math.abs(Math.sin(t * 16));
          mouthOpen = 0.35 + chew * 1.2 * env;
          for (const c of this.cheeks) c.scale.setScalar(1 + 0.25 * Math.min(1, p * 2));
          this.head.rotation.x += 0.1 * env;
        } else if (a === "nod") {
          this.head.rotation.x += Math.sin(p * Math.PI * 4) * 0.35;
        } else if (a === "think") {
          this.head.rotation.z += 0.3 * env;
          this.head.rotation.x -= 0.12 * env;
          armR.rotation.set(-1.9 * env, 0, -0.6 * env);
          this.ears[1].rotation.z = this.ears[1].userData.baseZ + Math.sin(t * 6) * 0.2 * env;
        } else if (a === "happy") {
          this.root.position.y = Math.abs(Math.sin(t * 10)) * 0.15 * env;
          for (const [i, ear] of this.ears.entries()) ear.rotation.z = ear.userData.baseZ + Math.sin(t * 14 + i) * 0.35 * env;
          eyeOpen = Math.min(eyeOpen, 1 - 0.75 * env);
          armL.rotation.z = -0.18 - 0.8 * env;
          armR.rotation.z = 0.18 + 0.8 * env;
          mouthOpen = 0.35 + env;
        } else if (a === "clap") {
          const c = Math.abs(Math.sin(t * 9));
          armL.rotation.set(-1.4 * env, 0, (0.15 + c * 0.45) * env);
          armR.rotation.set(-1.4 * env, 0, -(0.15 + c * 0.45) * env);
          this.root.position.y = c * 0.05 * env;
        } else if (a === "sleepy") {
          this.head.rotation.x += 0.35 * env;
          this.head.rotation.z += 0.12 * env;
          eyeOpen = Math.min(eyeOpen, 1 - env);
          this.body.scale.y = 1 + Math.sin(t * 1.5) * 0.03;
        }
      }
    }

    for (const eye of this.eyes) eye.scale.y = Math.max(0.08, eyeOpen);
    this.mouth.scale.y = mouthOpen * 0.35;
  }
}
