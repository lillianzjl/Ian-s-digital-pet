// Ginger from a static 3D model (GLB) whose parts are separate, named meshes
// (Head_soft_round, Arm_L, Eye_L, ...), but which has no skeleton or animations.
// We add joints (pivot groups) at the neck, shoulders, eyes, ears, cheeks and mouth
// when it loads, then reuse the procedural hamster's animations to move them.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Hamster } from "./hamster.js";

// Per-model settings: how the file is oriented and what its parts are called.
// Ginger v7: smooth, rounded, no fur. Stored Z-up, facing -Y.
export const GINGER_V7 = {
  url: "/models/ginger-v7.glb",
  orient: new THREE.Matrix4().makeRotationX(-Math.PI / 2),
  head: "Head_soft_round",
  headParts: ["Head_soft_round", "Muzzle", "Nose", "Tooth_L", "Tooth_R", "Ear_L", "EarInner_L", "Ear_R", "EarInner_R", "Eye_L", "Eye_R", "Cheek_L", "Cheek_R"],
  eye: (s) => [`Eye_${s}`],
  cheek: (s) => [`Cheek_${s}`],
  arm: (s) => [`Arm_${s}`],
  hand: null, // no separate paws: use the bottom of the arm
  mouth: null, // no mouth in the file: one is added so Ginger can talk
  addEyeShine: true,
  hide: null,
};

// The procedural hamster's rest pose, which the shared animations assume.
// Inner groups undo it, so the model rests exactly as it was modeled.
const ARM_REST = { L: new THREE.Euler(-0.5, 0, -0.25), R: new THREE.Euler(-0.5, 0, 0.25) };
const CHEEK_REST = new THREE.Vector3(1, 0.92, 0.9);
const MOUTH_REST = new THREE.Vector3(1.3, 0.8 * 1.2, 1.1);

export class GlbHamster extends Hamster {
  constructor(profile) {
    super({ build: false });
    this.profile = profile;
    // Ginger's arms are short and her cheeks big: wave forward so the paw shows beside the face.
    this.waveReach = { x: -1.1, z: 1.9 };
    this.root = new THREE.Group();
    this.ready = false;
    this.load(profile.url);
  }

  async load(url) {
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      this.build(gltf.scene);
      this.ready = true;
      console.info("[Ginger] 3D model loaded:", url);
    } catch (err) {
      console.error("[Ginger] could not load 3D model:", err);
    }
  }

  build(scene) {
    const P = this.profile;
    // Collect the named meshes and bake them into this page's coordinates (Y up, facing +Z).
    const parts = {};
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (!o.isMesh || (P.hide && P.hide.test(o.name))) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      g.applyMatrix4(P.orient);
      g.computeVertexNormals();
      // The file stores sRGB colors; three.js expects linear ones.
      const col = g.getAttribute("color");
      if (col) {
        const c = new THREE.Color();
        for (let i = 0; i < col.count; i++) {
          c.setRGB(col.getX(i), col.getY(i), col.getZ(i), THREE.SRGBColorSpace);
          col.setXYZ(i, c.r, c.g, c.b);
        }
      }
      const strands = /strands/i.test(o.name);
      const mesh = new THREE.Mesh(
        g,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: strands ? 0.9 : 0.6,
          side: strands ? THREE.DoubleSide : THREE.FrontSide,
        })
      );
      mesh.name = o.name;
      mesh.castShadow = !strands;
      parts[o.name] = mesh;
    });

    const boxOf = (...names) => {
      const box = new THREE.Box3();
      for (const n of names) if (parts[n]) box.union(new THREE.Box3().setFromObject(parts[n]));
      return box;
    };
    const centerOf = (...names) => boxOf(...names).getCenter(new THREE.Vector3());

    // Scale to the same height as the procedural hamster and stand on the floor.
    const all = boxOf(...Object.keys(parts));
    const scale = 2.6 / (all.max.y - all.min.y);
    const c = all.getCenter(new THREE.Vector3());
    for (const m of Object.values(parts)) {
      m.geometry.translate(-c.x, -all.min.y, -c.z);
      m.geometry.scale(scale, scale, scale);
    }

    // The animations expect arms[0] on the -x side and arms[1] on the +x side.
    // Some files are mirrored, so sort the arms by where they really are.
    const sides = ["L", "R"].sort((a, b) => centerOf(...P.arm(a)).x - centerOf(...P.arm(b)).x);
    // Where the +x paw (which holds the seed) is, measured before any joints are added.
    let handR;
    if (P.hand) handR = centerOf(...P.hand(sides[1]));
    else {
      const b = boxOf(...P.arm(sides[1]));
      handR = new THREE.Vector3(b.getCenter(new THREE.Vector3()).x, b.min.y + 0.08, b.max.z);
    }

    // Parts the file doesn't have: eye shine and a mouth.
    const extra = (name, geo, color, at, scl) => {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.35 }));
      m.name = name;
      m.position.copy(at);
      m.scale.set(...scl);
      parts[name] = m;
      return name;
    };
    const extraEye = { L: [], R: [] };
    if (P.addEyeShine) {
      for (const s of ["L", "R"]) {
        const b = boxOf(...P.eye(s));
        const size = b.getSize(new THREE.Vector3());
        const c0 = b.getCenter(new THREE.Vector3());
        const r = Math.min(size.x, size.y);
        extraEye[s].push(extra(`Shine_${s}`, new THREE.SphereGeometry(r * 0.16, 12, 8), 0xffffff, new THREE.Vector3(c0.x + size.x * 0.18, c0.y + size.y * 0.2, b.max.z), [1, 1, 0.4]));
        extraEye[s].push(extra(`Shine2_${s}`, new THREE.SphereGeometry(r * 0.07, 10, 6), 0xffffff, new THREE.Vector3(c0.x - size.x * 0.15, c0.y - size.y * 0.18, b.max.z), [1, 1, 0.4]));
      }
    }
    let mouthName = P.mouth;
    if (!mouthName) {
      // A small dark mouth between the nose and the teeth, just behind the teeth.
      const teeth = boxOf("Tooth_L", "Tooth_R");
      const nose = boxOf("Nose");
      const w = teeth.getSize(new THREE.Vector3()).x;
      const x = teeth.getCenter(new THREE.Vector3()).x;
      const y = teeth.max.y + Math.max(0, nose.min.y - teeth.max.y) * 0.3;
      // Sit on the muzzle's surface: shoot a ray at it from the front.
      let z = teeth.max.z;
      if (parts.Muzzle) {
        const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 50), new THREE.Vector3(0, 0, -1));
        const hit = ray.intersectObject(parts.Muzzle)[0];
        if (hit) z = hit.point.z;
      }
      const at = new THREE.Vector3(x, y, z - w * 0.08);
      mouthName = extra("Mouth_added", new THREE.SphereGeometry(w * 0.42, 20, 14), 0x6e2433, at, [1.3, 0.45, 0.45]);
    }

    this.body = new THREE.Group();
    this.root.add(this.body);
    for (const m of Object.values(parts)) this.body.add(m);

    // Joint helper: a pivot group at `at`, holding `names`, attached under `parent`.
    const joint = (parent, at, names) => {
      const pivot = new THREE.Group();
      parent.updateMatrixWorld(true);
      pivot.position.copy(parent.worldToLocal(at.clone())); // `at` is in world space
      parent.add(pivot);
      pivot.updateMatrixWorld(true);
      for (const n of names) if (parts[n]) pivot.attach(parts[n]);
      return pivot;
    };
    const restLayer = (pivot, setup) => {
      // An inner group that cancels the shared animations' rest pose.
      const inner = new THREE.Group();
      setup(inner);
      // Keep each part's placement relative to the joint, so that
      // (animation rest pose) x (this inverse) = the pose it was modeled in.
      const kids = [...pivot.children];
      pivot.add(inner);
      for (const k of kids) inner.add(k);
      return pivot;
    };

    // Neck: just below the bottom of the head sphere's middle.
    const headBox = boxOf(P.head);
    const neck = new THREE.Vector3(0, headBox.min.y + (headBox.max.y - headBox.min.y) * 0.2, headBox.getCenter(new THREE.Vector3()).z);
    this.head = joint(this.body, neck, [...P.headParts, ...extraEye.L, ...extraEye.R, mouthName]);

    // Eyes blink by squashing around their centers.
    this.eyes = ["L", "R"].map((s) => joint(this.head, centerOf(...P.eye(s)), [...P.eye(s), ...extraEye[s]]));

    // Ears wiggle from their base.
    this.ears = ["L", "R"].map((s) => {
      const b = boxOf(`Ear_${s}`);
      const at = new THREE.Vector3(b.getCenter(new THREE.Vector3()).x, b.min.y, b.getCenter(new THREE.Vector3()).z);
      const ear = joint(this.head, at, [`Ear_${s}`, `EarInner_${s}`]);
      ear.userData.baseZ = 0;
      return ear;
    });

    // Cheeks puff up when eating.
    this.cheeks = ["L", "R"].map((s) =>
      restLayer(joint(this.head, centerOf(...P.cheek(s)), P.cheek(s)), (g) => g.scale.set(1 / CHEEK_REST.x, 1 / CHEEK_REST.y, 1 / CHEEK_REST.z))
    );

    // Mouth opens when talking.
    this.mouth = restLayer(joint(this.head, centerOf(mouthName), [mouthName]), (g) =>
      g.scale.set(1 / MOUTH_REST.x, 1 / MOUTH_REST.y, 1 / MOUTH_REST.z)
    );

    // Shoulders: top of each arm.
    this.arms = sides.map((s, i) => {
      const b = boxOf(...P.arm(s));
      const at = new THREE.Vector3(b.getCenter(new THREE.Vector3()).x, b.max.y, b.getCenter(new THREE.Vector3()).z);
      return restLayer(joint(this.body, at, [...P.arm(s), ...(P.hand ? P.hand(s) : [])]), (g) =>
        g.quaternion.setFromEuler(ARM_REST[i === 0 ? "L" : "R"]).invert()
      );
    });

    // Sunflower seed held in the right paw when eating.
    const hand = handR;
    this.seed = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), new THREE.MeshStandardMaterial({ color: 0x2f2f2f, roughness: 0.4 }));
    this.seed.scale.set(0.7, 1.4, 0.5);
    this.seed.visible = false;
    const shoulder = this.arms[1];
    shoulder.updateMatrixWorld(true); // still unrotated here
    this.seed.position.copy(shoulder.worldToLocal(hand.clone().add(new THREE.Vector3(0, 0.05, 0.12))));
    shoulder.children[0].add(this.seed);
  }

  // Did a tap land on the head (for head pats)?
  isHeadHit(hit) {
    for (let o = hit.object; o; o = o.parent) if (o === this.head) return true;
    return false;
  }

  update(t) {
    if (this.ready) super.update(t);
  }
}
