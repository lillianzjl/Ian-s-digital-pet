// Ginger: a chubby, fluffy 3D Syrian hamster with procedural animations.
// Fur is drawn with "shells": stacked, slightly larger copies of each body part
// whose pixels are cut out by a noise texture, so the outline looks soft and furry.
import * as THREE from "three";

const GOLD = new THREE.Color(0xe8963f);
const CREAM = new THREE.Color(0xfff6ea);
const PINK = 0xf7aab8;

function noiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.random() * 255;
    data.set([v, v, v, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.repeat.set(16, 16);
  tex.needsUpdate = true;
  return tex;
}
const FUR_NOISE = noiseTexture();

// Builds a furry ellipsoid. colorAt(normal) returns how "cream" (0) vs "gold" (1) a spot is.
// lengthAt(normal) scales fur length, e.g. short fur on the face so eyes stay visible.
function furBall(radius, scale, colorAt, { layers = 14, length = 0.06, lengthAt = () => 1 } = {}) {
  const geo = new THREE.SphereGeometry(radius, 56, 40);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nrm, i);
    const g = THREE.MathUtils.clamp(colorAt(n), 0, 1);
    c.copy(CREAM).lerp(GOLD, g);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const group = new THREE.Group();
  group.scale.set(...scale);
  const base = new THREE.Mesh(
    geo,
    new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.85, sheen: 1, sheenRoughness: 0.6, sheenColor: 0xffffff })
  );
  base.castShadow = true;
  group.add(base);

  for (let i = 1; i <= layers; i++) {
    const k = i / layers;
    const shell = geo.clone();
    const p = shell.attributes.position;
    for (let v = 0; v < p.count; v++) {
      n.fromBufferAttribute(nrm, v);
      const len = length * k * lengthAt(n);
      p.setXYZ(v, p.getX(v) + n.x * len, p.getY(v) + n.y * len - 0.01 * k * k, p.getZ(v) + n.z * len);
    }
    const shade = 0.72 + 0.28 * k; // darker near the skin, brighter at the tips
    const mesh = new THREE.Mesh(
      shell,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        color: new THREE.Color(shade, shade, shade),
        roughness: 1,
        alphaMap: FUR_NOISE,
        alphaTest: 0.25 + 0.7 * k,
      })
    );
    group.add(mesh);
  }
  return group;
}

const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, Math.min(a, b), Math.max(a, b)) * (a < b ? 1 : -1) + (a < b ? 0 : 1);

export class Hamster {
  // build: false skips making the procedural model, so a loaded 3D model
  // (see glb-hamster.js) can reuse the same animations.
  constructor({ build = true } = {}) {
    this.action = null;
    this.actionStart = 0;
    this.talking = false;
    this.nextBlink = 2;
    this.look = new THREE.Vector2();
    if (!build) return;

    const solid = (r, color, pos, scale = [1, 1, 1], opts = {}) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), new THREE.MeshPhysicalMaterial({ color, roughness: 0.6, ...opts }));
      m.position.set(...pos);
      m.scale.set(...scale);
      m.castShadow = true;
      return m;
    };

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    // Chubby body: golden back and sides, cream tummy.
    const body = furBall(0.82, [1.06, 1.0, 0.96], (n) => 1 - smooth(0.2, 0.75, n.z) * smooth(0.7, 0.2, n.y));
    body.position.set(0, 0.86, 0);
    this.body.add(body);
    this.body.add(solid(0.12, 0xfff6ea, [0, 0.4, -0.78])); // tiny tail

    // Feet
    for (const s of [-1, 1]) this.body.add(solid(0.16, PINK, [0.34 * s, 0.07, 0.5], [1, 0.45, 1.5]));

    // Head (pivot at the neck). Golden forehead and back of head, cream face and chin.
    this.head = new THREE.Group();
    this.head.position.set(0, 1.42, 0.05);
    this.body.add(this.head);
    const head = furBall(
      0.78,
      [1.12, 0.97, 1],
      (n) => 1 - smooth(0.25, 0.7, n.z) * smooth(0.35, -0.05, n.y),
      { lengthAt: (n) => 1 - 0.8 * smooth(0.45, 0.8, n.z) }
    );
    head.position.set(0, 0.5, 0);
    this.head.add(head);

    // Fluffy cheeks (they puff up when eating)
    this.cheeks = [];
    for (const s of [-1, 1]) {
      const cheek = furBall(0.33, [1, 0.92, 0.9], () => 0.03, { layers: 10, length: 0.05 });
      cheek.position.set(0.5 * s, 0.26, 0.3);
      this.cheeks.push(cheek);
      this.head.add(cheek);
    }
    // Muzzle puffs and nose
    for (const s of [-1, 1]) this.head.add(solid(0.15, 0xfffaf3, [0.11 * s, 0.37, 0.75], [1, 0.85, 0.75], { sheen: 1 }));
    this.head.add(solid(0.07, 0xf28da0, [0, 0.48, 0.86], [1.35, 0.85, 0.8], { clearcoat: 0.6 }));

    // Happy open mouth with tongue and two buck teeth
    this.mouth = new THREE.Group();
    this.mouth.position.set(0, 0.24, 0.79);
    this.mouth.add(solid(0.11, 0x8a2f43, [0, 0, 0], [1.05, 0.95, 0.45]));
    this.mouth.add(solid(0.075, 0xff8fa5, [0, -0.045, 0.035], [1.1, 0.6, 0.6]));
    for (const s of [-1, 1]) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.03), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, clearcoat: 1 }));
      tooth.position.set(0.028 * s, 0.07, 0.05);
      this.mouth.add(tooth);
    }
    this.head.add(this.mouth);

    // Big glossy eyes with sparkles
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(0.33 * s, 0.64, 0.71);
      eye.rotation.y = 0.35 * s;
      eye.add(solid(0.14, 0x0d0a0a, [0, 0, 0], [0.95, 1.1, 0.6], { roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 }));
      const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const big = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), white);
      big.position.set(0.04, 0.05, 0.08);
      const small = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 6), white);
      small.position.set(-0.035, -0.04, 0.08);
      eye.add(big, small);
      this.eyes.push(eye);
      this.head.add(eye);
    }

    // Whiskers
    const pts = [];
    for (const s of [-1, 1]) {
      for (const [dy, dz] of [[0.06, 0.02], [0, 0], [-0.06, -0.02]]) {
        pts.push(new THREE.Vector3(0.2 * s, 0.4 + dy * 0.3, 0.84), new THREE.Vector3(0.85 * s, 0.4 + dy * 2.2, 0.66 + dz));
      }
    }
    this.head.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 })
    ));

    // Rounded pink ears
    this.ears = [];
    for (const s of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(0.55 * s, 1.08, -0.05);
      ear.userData.baseZ = -0.4 * s;
      ear.add(solid(0.25, 0xeab4a2, [0, 0, 0], [1, 1.05, 0.35], { sheen: 1 }));
      ear.add(solid(0.18, 0xf6a3b3, [0, -0.01, 0.06], [1, 1.05, 0.25]));
      this.ears.push(ear);
      this.head.add(ear);
    }

    // Short arms with pink paws held in front of the tummy
    this.arms = [];
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(0.46 * s, 1.2, 0.74);
      const limb = furBall(0.13, [1, 1.6, 1], () => 0.15, { layers: 6, length: 0.03 });
      limb.position.y = -0.15;
      arm.add(limb);
      const paw = new THREE.Group();
      paw.position.set(0, -0.36, 0.04);
      paw.add(solid(0.09, PINK, [0, 0, 0], [1, 0.8, 0.8]));
      for (const f of [-1, 0, 1]) paw.add(solid(0.032, PINK, [f * 0.05, -0.065, 0.03]));
      arm.add(paw);
      this.arms.push(arm);
      this.body.add(arm);
    }

    // Sunflower seed held when eating
    this.seed = solid(0.08, 0x2f2f2f, [0, -0.4, 0.15], [0.7, 1.4, 0.5], { roughness: 0.4 });
    this.seed.visible = false;
    this.arms[1].add(this.seed);
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

    // Base pose: breathing, soft sway, head follows the pointer
    this.root.position.y = 0;
    this.root.rotation.set(0, 0, 0);
    this.body.scale.set(1, 1 + Math.sin(t * 2.2) * 0.012, 1);
    this.body.rotation.z = Math.sin(t * 0.9) * 0.025;
    this.head.rotation.set(-this.look.y * 0.15, this.look.x * 0.3, Math.sin(t * 0.7) * 0.04);
    armL.rotation.set(-0.5, 0, -0.25 - Math.sin(t * 2.2) * 0.03);
    armR.rotation.set(-0.5, 0, 0.25 + Math.sin(t * 2.2) * 0.03);
    for (const ear of this.ears) ear.rotation.set(0, 0, ear.userData.baseZ);
    for (const c of this.cheeks) c.scale.set(1, 0.92, 0.9);
    this.seed.visible = false;
    let eyeOpen = 1;
    let mouthOpen = this.talking ? 0.45 + Math.abs(Math.sin(t * 13)) * 0.75 : 0.8;

    // Blinking
    if (t > this.nextBlink) {
      const k = (t - this.nextBlink) / 0.15;
      eyeOpen = k < 1 ? Math.abs(1 - 2 * k) : 1;
      if (k >= 1) this.nextBlink = t + 2 + Math.random() * 3;
    }

    if (this.action) {
      const p = (t - this.actionStart) / this.actionDuration;
      if (p >= 1) {
        this.action = null;
      } else {
        const env = Math.sin(Math.PI * p);
        const a = this.action;
        if (a === "wave") {
          const reach = this.waveReach || { x: 0.2, z: 2.4 };
          armR.rotation.set(-0.5 + reach.x * env, Math.sin(t * 12) * 0.5 * env, 0.25 + env * reach.z);
          this.head.rotation.z += 0.15 * env;
        } else if (a === "jump") {
          const hop = (p * 2) % 1;
          this.root.position.y = Math.sin(Math.PI * hop) * 0.55;
          const squash = hop < 0.12 || hop > 0.9 ? 0.9 : 1.04;
          this.body.scale.set(2 - squash, squash, 2 - squash);
          armL.rotation.z = -0.25 - 1.5 * Math.sin(Math.PI * hop);
          armR.rotation.z = 0.25 + 1.5 * Math.sin(Math.PI * hop);
          mouthOpen = 1.1;
        } else if (a === "dance") {
          this.root.rotation.y = p < 0.5 ? 0 : (p - 0.5) * 2 * Math.PI * 2;
          this.body.rotation.z = Math.sin(t * 8) * 0.18 * env;
          armL.rotation.z = -0.4 - (Math.sin(t * 8) * 0.5 + 0.9) * env;
          armR.rotation.z = 0.4 + (Math.sin(t * 8 + Math.PI) * 0.5 + 0.9) * env;
          this.root.position.y = Math.abs(Math.sin(t * 8)) * 0.12 * env;
          eyeOpen = Math.min(eyeOpen, 0.35);
        } else if (a === "wash") {
          const rub = Math.sin(t * 10) * 0.18;
          armL.rotation.set(-0.5 - 1.6 * env, 0, -0.25 + (0.75 + rub) * env);
          armR.rotation.set(-0.5 - 1.6 * env, 0, 0.25 - (0.75 + rub) * env);
          this.head.rotation.x += 0.15 * env;
          eyeOpen = Math.min(eyeOpen, 1 - env);
          mouthOpen = 0.4;
        } else if (a === "eat") {
          this.seed.visible = p > 0.05 && p < 0.85;
          armR.rotation.set(-0.5 - 1.2 * env, 0, 0.25 - 0.7 * env);
          armL.rotation.set(-0.5 - 1.0 * env, 0, -0.25 + 0.6 * env);
          mouthOpen = 0.3 + Math.abs(Math.sin(t * 16)) * 0.6 * env;
          const puff = 1 + 0.3 * Math.min(1, p * 2);
          for (const c of this.cheeks) c.scale.set(puff, 0.92 * puff, 0.9 * puff);
          this.head.rotation.x += 0.1 * env;
        } else if (a === "nod") {
          this.head.rotation.x += Math.sin(p * Math.PI * 4) * 0.3;
        } else if (a === "think") {
          this.head.rotation.z += 0.3 * env;
          this.head.rotation.x -= 0.12 * env;
          armR.rotation.set(-0.5 - 1.3 * env, 0, 0.25 - 0.8 * env);
          this.ears[1].rotation.z = this.ears[1].userData.baseZ + Math.sin(t * 6) * 0.2 * env;
          mouthOpen = 0.35;
        } else if (a === "happy") {
          this.root.position.y = Math.abs(Math.sin(t * 10)) * 0.15 * env;
          for (const [i, ear] of this.ears.entries()) ear.rotation.z = ear.userData.baseZ + Math.sin(t * 14 + i) * 0.35 * env;
          eyeOpen = Math.min(eyeOpen, 1 - 0.75 * env);
          armL.rotation.z = -0.25 - 0.8 * env;
          armR.rotation.z = 0.25 + 0.8 * env;
          mouthOpen = 0.8 + 0.5 * env;
        } else if (a === "clap") {
          const c = Math.abs(Math.sin(t * 9));
          armL.rotation.set(-0.5 - 0.6 * env, 0, -0.25 + (0.25 + c * 0.35) * env);
          armR.rotation.set(-0.5 - 0.6 * env, 0, 0.25 - (0.25 + c * 0.35) * env);
          this.root.position.y = c * 0.05 * env;
        } else if (a === "sleepy") {
          this.head.rotation.x += 0.35 * env;
          this.head.rotation.z += 0.12 * env;
          eyeOpen = Math.min(eyeOpen, 1 - env);
          mouthOpen = 0.35;
          this.body.scale.y = 1 + Math.sin(t * 1.5) * 0.03;
        }
      }
    }

    for (const eye of this.eyes) eye.scale.y = Math.max(0.08, eyeOpen);
    this.mouth.scale.set(1.3, mouthOpen * 1.2, 1.1);
  }
}
