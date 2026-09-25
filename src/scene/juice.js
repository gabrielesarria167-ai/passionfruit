import * as THREE from 'three';
import { createJellyInstances } from './materials.js';

const MAX_DROPS = 420;
const MAX_SPLATS = 520;
const MAX_PIECES = 200;
const UP = new THREE.Vector3(0, 1, 0);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _seedOffset = new THREE.Matrix4().makeScale(0.9, 0.9, 0.9);

// A shallow lens with an irregular rim: the shape a drop of juice leaves.
function createSplatGeometry() {
  const seg = 36;
  const rings = [0.38, 0.72, 1.0];
  const heights = [0.86, 0.52, 0.0];
  const pos = [0, 1, 0];
  for (let r = 0; r < rings.length; r++) {
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const wobble = 1 + 0.05 * Math.sin(3 * t + 0.7) + 0.03 * Math.sin(5 * t + 2.1) + 0.012 * Math.sin(9 * t + 0.3);
      const rad = rings[r] * (1 + (wobble - 1) * rings[r]);
      pos.push(Math.cos(t) * rad, heights[r], Math.sin(t) * rad);
    }
  }
  const idx = [];
  for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < seg; i++) {
      const a = 1 + r * seg + i;
      const b = 1 + r * seg + ((i + 1) % seg);
      const c = a + seg;
      const d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export class JuiceSystem {
  constructor({ materials, arilGeometry, seedGeometry, gravity }) {
    this.gravity = gravity;
    this.group = new THREE.Group();

    this.dropGeometry = new THREE.SphereGeometry(1, 12, 8);
    this.splatGeometry = createSplatGeometry();
    this.drops = createJellyInstances(this.dropGeometry, materials.juice, MAX_DROPS, 7);
    this.splats = createJellyInstances(this.splatGeometry, materials.splat, MAX_SPLATS, 1);
    this.pieces = createJellyInstances(arilGeometry, materials.aril, MAX_PIECES, 5);
    this.pieceSeeds = new THREE.InstancedMesh(seedGeometry, materials.seed, MAX_PIECES);
    this.pieceSeeds.layers.enable(1);
    this.pieces.filter.layers.enable(1);
    this.meshes = [...this.drops.meshes, ...this.splats.meshes, ...this.pieces.meshes, this.pieceSeeds];
    for (const mesh of this.meshes) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }

    this.dropState = [];
    for (let i = 0; i < MAX_DROPS; i++) {
      this.dropState.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0, delay: 0, alive: false, keep: 1 });
    }
    this.splatState = [];
    this.pieceState = [];
    for (let i = 0; i < MAX_PIECES; i++) {
      this.pieceState.push({
        p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(),
        restQ: new THREE.Quaternion(), s: 1, landed: false, splatted: false, alive: false, delay: 0, keep: 1,
      });
    }
    this.active = false;
  }

  reset() {
    for (const d of this.dropState) d.alive = false;
    for (const p of this.pieceState) p.alive = false;
    this.splatState.length = 0;
    this.drops.count = 0;
    this.splats.count = 0;
    this.pieces.count = 0;
    this.pieceSeeds.count = 0;
    this.active = false;
  }

  // Spray juice and a few whole sacs out of the opening tear.
  burst({ center, normal, rand }) {
    const e1 = new THREE.Vector3().crossVectors(normal, UP);
    if (e1.lengthSq() < 1e-4) e1.set(0, 0, 1);
    e1.normalize();
    const e2 = new THREE.Vector3().crossVectors(e1, normal).normalize();
    if (e2.y < 0) e2.negate();
    const dir = new THREE.Vector3();

    let n = 0;
    const spawnDrop = (rMin, rMax, speedMul) => {
      if (n >= MAX_DROPS) return;
      let tries = 0;
      do {
        const psi = (rand() * 2 - 1) * 1.35;
        dir.copy(e2).multiplyScalar(Math.cos(psi)).addScaledVector(e1, Math.sin(psi));
        tries++;
      } while (dir.y < -0.1 && tries < 8);
      const d = this.dropState[n++];
      d.alive = true;
      d.keep = 1;
      d.delay = rand() * 0.07;
      d.r = rMin + (rMax - rMin) * Math.pow(rand(), 2.2);
      d.p.copy(center).addScaledVector(dir, 0.93 + 0.12 * rand()).addScaledVector(normal, (rand() - 0.5) * 0.07);
      const speed = (0.9 + 2.6 * Math.pow(rand(), 1.6)) * speedMul * (1.15 - d.r * 4);
      d.v.copy(dir).multiplyScalar(speed);
      d.v.y += 0.7 + 2.0 * rand();
      d.v.addScaledVector(normal, (rand() - 0.5) * 1.1);
    };
    for (let i = 0; i < 60; i++) spawnDrop(0.01, 0.042, 1);
    for (let i = 0; i < 45; i++) spawnDrop(0.004, 0.01, 1.3);

    for (let i = 0; i < 5; i++) {
      const pc = this.pieceState[i];
      const psi = (rand() * 2 - 1) * 0.95;
      dir.copy(e2).multiplyScalar(Math.cos(psi)).addScaledVector(e1, Math.sin(psi));
      pc.alive = true;
      pc.keep = 1;
      pc.landed = false;
      pc.splatted = false;
      pc.delay = 0.015 + rand() * 0.05;
      pc.s = 0.82 + 0.22 * rand();
      pc.p.copy(center).addScaledVector(dir, 0.8).addScaledVector(normal, (rand() - 0.5) * 0.1);
      pc.v.copy(dir).multiplyScalar(0.9 + 1.1 * rand());
      pc.v.y += 1.3 + 1.1 * rand();
      pc.v.addScaledVector(normal, (rand() - 0.5) * 0.8);
      pc.q.setFromEuler(new THREE.Euler(rand() * 6.28, rand() * 6.28, rand() * 6.28));
      pc.w.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(14);
      pc.restQ.setFromAxisAngle(UP, rand() * Math.PI * 2);
    }
    this.rand = rand;
    this.age = 0;
    this.active = true;
  }

  // The fruit bursts: pulp and juice fly out in every direction and what was
  // under it spreads into a puddle.
  explode({ center, rand, power = 1 }) {
    const dir = new THREE.Vector3();
    const flat = new THREE.Vector3();
    this.rand = rand;
    this.age = 0;
    this.active = true;

    // What was underneath spreads into an uneven puddle.
    for (let i = 0; i < 16; i++) {
      const a = rand() * Math.PI * 2;
      const r = i === 0 ? 0 : 0.62 * Math.sqrt(rand());
      this.addSplat(
        center.x + Math.cos(a) * r, center.z + Math.sin(a) * r,
        0.2 + 0.32 * (1 - r), 0, 0, 0.018 + 0.012 * (1 - r), 0.2 + 0.5 * rand(),
      );
    }

    let n = 0;
    const spawnDrop = (rMin, rMax, speedMul) => {
      if (n >= MAX_DROPS) return;
      randomUnit(rand, dir);
      if (dir.y < -0.3) dir.y = -dir.y * 0.5;
      dir.normalize();
      flat.set(dir.x, 0, dir.z).normalize();
      const up = 0.5 + 0.5 * dir.y;
      const d = this.dropState[n++];
      d.alive = true;
      d.keep = 1;
      d.delay = rand() * 0.04;
      d.r = rMin + (rMax - rMin) * Math.pow(rand(), 2.2);
      d.p.copy(center).addScaledVector(dir, 0.75 + 0.25 * rand());
      if (d.p.y < d.r) d.p.y = d.r;
      const speed = (0.7 + 2.6 * Math.pow(rand(), 1.3)) * speedMul * power * (1.15 - d.r * 4);
      d.v.copy(flat).multiplyScalar(speed);
      d.v.y = (2.4 + 6.4 * rand()) * (0.4 + 0.6 * up) * speedMul * power;
    };
    for (let i = 0; i < 280; i++) spawnDrop(0.01, 0.05, 1);
    for (let i = 0; i < 130; i++) spawnDrop(0.004, 0.01, 1.25);

    for (let i = 0; i < 190; i++) {
      const pc = this.pieceState[i];
      randomUnit(rand, dir);
      const depth = Math.cbrt(rand()) * 0.78;
      pc.p.copy(center).addScaledVector(dir, depth);
      pc.p.y = Math.max(0.12, center.y + (pc.p.y - center.y) * 1.05);
      flat.set(dir.x, 0, dir.z);
      if (flat.lengthSq() < 1e-4) flat.set(rand() - 0.5, 0, rand() - 0.5);
      flat.normalize();
      const up = 0.5 + 0.5 * dir.y;
      // A share of the pulp barely leaves: it slumps where the fruit landed.
      const slump = rand() < 0.22;
      const speed = (slump ? 0.25 + 0.6 * rand() : 0.5 + 2.4 * Math.pow(rand(), 1.2)) * power;
      pc.v.copy(flat).multiplyScalar(speed * (0.6 + 0.6 * depth));
      pc.v.y = (slump ? 0.4 * rand() : 2.2 + 5.6 * rand()) * (0.35 + 0.65 * up) * power;
      pc.alive = true;
      pc.keep = 1;
      pc.landed = false;
      pc.splatted = false;
      pc.delay = rand() * 0.03;
      pc.s = 0.8 + 0.28 * rand();
      pc.q.setFromEuler(new THREE.Euler(rand() * 6.28, rand() * 6.28, rand() * 6.28));
      pc.w.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(16);
      pc.restQ.setFromAxisAngle(UP, rand() * Math.PI * 2);
    }
  }

  addSplat(x, z, radius, vx, vz, height, grow = 0.08) {
    if (this.splatState.length >= MAX_SPLATS) return;
    const vh = Math.hypot(vx, vz);
    const stretch = 1 + Math.min(0.6, 0.08 * vh);
    this.splatState.push({
      x, z,
      yaw: vh > 1e-3 ? -Math.atan2(vz, vx) : this.rand() * Math.PI * 2,
      sx: radius * stretch,
      sz: radius / Math.sqrt(stretch),
      h: height,
      grow,
      age: 0,
      keep: 1,
    });
  }

  update(dt) {
    if (!this.active) return;
    this.age += dt;
    const g = this.gravity;

    for (const d of this.dropState) {
      if (!d.alive) continue;
      if (this.age < d.delay) continue;
      d.v.y -= g * dt;
      d.v.multiplyScalar(Math.exp(-0.15 * dt));
      d.p.addScaledVector(d.v, dt);
      if (d.p.y < d.r * 0.6) {
        d.alive = false;
        // The finest mist barely marks the floor; skipping most of it keeps
        // the number of overlapping splats down.
        if (d.r > 0.009 || this.rand() < 0.4) {
          const spread = d.r * (1.5 + 0.9 * this.rand());
          this.addSplat(d.p.x, d.p.z, spread, d.v.x, d.v.z, Math.min(0.018, 0.45 * spread));
        }
      }
    }

    for (const piece of this.pieceState) {
      if (!piece.alive || this.age < piece.delay) continue;
      const rest = 0.1 * piece.s;
      if (!piece.landed) {
        piece.v.y -= g * dt;
        piece.p.addScaledVector(piece.v, dt);
        _q.setFromAxisAngle(_d.copy(piece.w).normalize(), piece.w.length() * dt);
        piece.q.premultiply(_q);
        if (piece.p.y < rest) {
          piece.p.y = rest;
          if (!piece.splatted) this.addSplat(piece.p.x, piece.p.z, 0.1 * piece.s, piece.v.x, piece.v.z, 0.008);
          piece.splatted = true;
          if (piece.v.y < -1.4) {
            piece.v.y *= -0.22;
            piece.v.x *= 0.55;
            piece.v.z *= 0.55;
            piece.w.multiplyScalar(0.4);
          } else {
            piece.landed = true;
            piece.v.y = 0;
          }
        }
      } else {
        piece.v.multiplyScalar(Math.exp(-9 * dt));
        piece.p.addScaledVector(piece.v, dt);
        piece.q.slerp(piece.restQ, 1 - Math.exp(-10 * dt));
        piece.p.y += (rest - piece.p.y) * (1 - Math.exp(-10 * dt));
      }
    }

    for (const sp of this.splatState) sp.age += dt;
  }

  // Write everything's current place into the instanced meshes. Each drop,
  // piece and splat is drawn at `keep` of its size.
  sync() {
    if (!this.active) return;
    let count = 0;
    for (const d of this.dropState) {
      if (!d.alive || this.age < d.delay || d.keep <= 0.001) continue;
      const speed = d.v.length();
      _d.copy(d.v).divideScalar(speed || 1);
      _q.setFromUnitVectors(UP, _d);
      const r = d.r * d.keep;
      _s.set(r, r * (1 + Math.min(1.6, 0.09 * speed)), r);
      _m.compose(d.p, _q, _s);
      this.drops.setMatrixAt(count++, _m);
    }
    this.drops.count = count;
    if (count) this.drops.filter.instanceMatrix.needsUpdate = true;

    let pc = 0;
    for (const piece of this.pieceState) {
      if (!piece.alive || this.age < piece.delay || piece.keep <= 0.001) continue;
      const k = piece.s * piece.keep;
      _s.set(k, k * (piece.landed ? 0.92 : 1), k);
      _m.compose(piece.p, piece.q, _s);
      this.pieces.setMatrixAt(pc, _m);
      _m.multiply(_seedOffset);
      this.pieceSeeds.setMatrixAt(pc, _m);
      pc++;
    }
    this.pieces.count = pc;
    this.pieceSeeds.count = pc;
    if (pc) {
      this.pieces.filter.instanceMatrix.needsUpdate = true;
      this.pieceSeeds.instanceMatrix.needsUpdate = true;
    }

    const splats = this.splatState;
    for (let i = 0; i < splats.length; i++) {
      const sp = splats[i];
      const grow = 1 - Math.pow(1 - Math.min(1, sp.age / sp.grow), 3);
      const k = (0.3 + 0.7 * grow) * sp.keep;
      _p.set(sp.x, 0.0006 + i * 0.00001, sp.z);
      _q.setFromAxisAngle(UP, sp.yaw);
      _s.set(sp.sx * k, sp.h * sp.keep, sp.sz * k);
      _m.compose(_p, _q, _s);
      this.splats.setMatrixAt(i, _m);
    }
    this.splats.count = splats.length;
    if (splats.length) this.splats.filter.instanceMatrix.needsUpdate = true;
  }

  // True once nothing is flying and every splat has spread.
  get settled() {
    if (!this.active) return true;
    for (const d of this.dropState) if (d.alive) return false;
    for (const p of this.pieceState) if (p.alive && (!p.landed || p.v.lengthSq() > 1e-4)) return false;
    for (const s of this.splatState) if (s.age < s.grow) return false;
    return true;
  }

  dispose() {
    this.dropGeometry.dispose();
    this.splatGeometry.dispose();
    for (const mesh of this.meshes) mesh.dispose();
  }
}

function randomUnit(rand, out) {
  const z = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(t), z, r * Math.sin(t));
}
