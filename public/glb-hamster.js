// Ginger from a static 3D model (GLB) whose parts are separate, named meshes
// (Head_Golden, Arm_L, Eye_L, ...), but which has no skeleton or animations.
// We add joints (pivot groups) at the neck, shoulders, eyes, ears, cheeks and mouth
// when it loads, then reuse the procedural hamster's animations to move them.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Hamster } from "./hamster.js";

// Which named parts belong to which joint.
const HEAD_PARTS = [
  "Head_Golden", "Muzzle", "Pink_Nose", "Tooth_L", "Tooth_R", "Head_individual_strands",
  "Ear_L", "EarInner_L", "Ear_R", "EarInner_R",
  "Eye_L", "EyeHighlight_L", "Eye_R", "EyeHighlight_R", "Mouth",
  "Cheek_L", "Cheek_R", "CheekL_individual_strands", "CheekR_individual_strands",
];

// The procedural hamster's rest pose, which the shared animations assume.
// Inner groups undo it, so the model rests exactly as it was modeled.
const ARM_REST = { L: new THREE.Euler(-0.5, 0, -0.25), R: new THREE.Euler(-0.5, 0, 0.25) };
const CHEEK_REST = new THREE.Vector3(1, 0.92, 0.9);
const MOUTH_REST = new THREE.Vector3(1.3, 0.8 * 1.2, 1.1);

export class GlbHamster extends Hamster {
  constructor(url) {
    super({ build: false });
    // Ginger's arms are short and her cheeks big: wave forward so the paw shows beside the face.
    this.waveReach = { x: -1.1, z: 1.9 };
    this.root = new THREE.Group();
    this.ready = false;
    this.load(url);
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
    // Collect the named meshes and bake them into this page's coordinates:
    // the model is Z-up, the page is Y-up.
    const parts = {};
    scene.updateMatrixWorld(true);
    const zUpToYUp = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      g.applyMatrix4(zUpToYUp);
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

    // Where the right paw is, measured before any joints are added.
    const handR = centerOf("Hand_R");

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
    const headBox = boxOf("Head_Golden");
    const neck = new THREE.Vector3(0, headBox.min.y + (headBox.max.y - headBox.min.y) * 0.2, headBox.getCenter(new THREE.Vector3()).z);
    this.head = joint(this.body, neck, HEAD_PARTS);

    // Eyes blink by squashing around their centers.
    this.eyes = ["L", "R"].map((s) => joint(this.head, centerOf(`Eye_${s}`), [`Eye_${s}`, `EyeHighlight_${s}`]));

    // Ears wiggle from their base.
    this.ears = ["L", "R"].map((s) => {
      const b = boxOf(`Ear_${s}`);
      const at = new THREE.Vector3(b.getCenter(new THREE.Vector3()).x, b.min.y, b.getCenter(new THREE.Vector3()).z);
      const ear = joint(this.head, at, [`Ear_${s}`, `EarInner_${s}`]);
      ear.userData.baseZ = 0;
      return ear;
    });

    // Cheeks puff up when eating.
    this.cheeks = [
      restLayer(joint(this.head, centerOf("Cheek_L"), ["Cheek_L", "CheekL_individual_strands"]), (g) => g.scale.set(1 / CHEEK_REST.x, 1 / CHEEK_REST.y, 1 / CHEEK_REST.z)),
      restLayer(joint(this.head, centerOf("Cheek_R"), ["Cheek_R", "CheekR_individual_strands"]), (g) => g.scale.set(1 / CHEEK_REST.x, 1 / CHEEK_REST.y, 1 / CHEEK_REST.z)),
    ];

    // Mouth opens when talking.
    this.mouth = restLayer(joint(this.head, centerOf("Mouth"), ["Mouth"]), (g) =>
      g.scale.set(1 / MOUTH_REST.x, 1 / MOUTH_REST.y, 1 / MOUTH_REST.z)
    );

    // Shoulders: top of each arm.
    this.arms = ["L", "R"].map((s) => {
      const b = boxOf(`Arm_${s}`);
      const at = new THREE.Vector3(b.getCenter(new THREE.Vector3()).x, b.max.y, b.getCenter(new THREE.Vector3()).z);
      return restLayer(joint(this.body, at, [`Arm_${s}`, `Hand_${s}`]), (g) =>
        g.quaternion.setFromEuler(ARM_REST[s]).invert()
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
