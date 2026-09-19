import * as THREE from 'three';
import { createNoise3D, mulberry32 } from './noise.js';

const TAU = Math.PI * 2;

// Fruit frame: origin at the centre, +Y runs through the stalk. The fruit tears
// open along a jagged line around the equator, y = crackY(phi); the "stem half"
// (side +1) keeps everything above it, the "blossom half" (side -1) the rest.
export const FRUIT_DIMS = { a: 1.0, b: 1.1, rind: 0.088 };

export const ARIL_RADII = new THREE.Vector3(0.122, 0.094, 0.1);
export const SEED_RADII = new THREE.Vector3(0.07, 0.019, 0.05);

export class FruitModel {
  constructor({ seed = 11, segPhi = 288, segV = 60 } = {}) {
    this.segPhi = segPhi;
    this.segV = segV;
    const rand = mulberry32(seed);
    this.seed = seed;
    this.noiseA = createNoise3D(rand);
    this.noiseB = createNoise3D(rand);
    this.noiseC = createNoise3D(rand);

    // The tear is a sum of harmonics in phi, so it closes on itself.
    this.crackTerms = [
      { k: 1, amp: 0.016, ph: rand() * TAU },
      { k: 2, amp: 0.034, ph: rand() * TAU },
      { k: 3, amp: 0.02, ph: rand() * TAU },
    ];
    for (let k = 5; k <= 46; k++) {
      this.crackTerms.push({ k, amp: (0.021 / Math.pow(k, 0.6)) * (0.35 + 0.65 * rand()), ph: rand() * TAU });
    }

    this.outerR = this.outerR.bind(this);
    this.innerR = this.innerR.bind(this);

    // Tabulate the rim (where each surface meets the tear) once.
    this.thetaOut = new Float32Array(segPhi);
    this.thetaIn = new Float32Array(segPhi);
    this.rimOuter = [];
    this.rimInner = [];
    for (let i = 0; i < segPhi; i++) {
      const phi = (i / segPhi) * TAU;
      const h = this.crackY(phi);
      this.thetaOut[i] = this.thetaRim(this.outerR, phi, h);
      this.thetaIn[i] = this.thetaRim(this.innerR, phi, h);
      this.rimOuter.push(this.point(this.outerR, this.thetaOut[i], phi, new THREE.Vector3()));
      this.rimInner.push(this.point(this.innerR, this.thetaIn[i], phi, new THREE.Vector3()));
    }

    // Collision proxy: slightly generous so lumps rarely dip into the ground.
    this.collider = { a: FRUIT_DIMS.a * 1.012, b: FRUIT_DIMS.b * 1.008 };
    this.rimSamples = [];
    for (let i = 0; i < 48; i++) this.rimSamples.push(this.rimOuter[Math.round((i / 48) * segPhi) % segPhi].clone());
  }

  crackY(phi) {
    let s = 0;
    for (const t of this.crackTerms) s += t.amp * Math.sin(t.k * phi + t.ph);
    return s;
  }

  // Radius of the skin along the unit direction (x, y, z).
  outerR(x, y, z) {
    const { a, b } = FRUIT_DIMS;
    const ell = 1 / Math.sqrt((x * x + z * z) / (a * a) + (y * y) / (b * b));
    let f = 1 + 0.017 * this.noiseA(x * 1.6, y * 1.6, z * 1.6) + 0.006 * this.noiseA(x * 3.8 + 7.1, y * 3.8, z * 3.8 - 2.3);
    f -= 0.026 * Math.exp(-(1 - y) / 0.01); // shallow dimple where the stalk attaches
    f += 0.016 * Math.exp(-(1 + y) / 0.0012); // tiny nub at the blossom end
    return ell * f;
  }

  rindT(x, y, z) {
    return FRUIT_DIMS.rind * (1 + 0.16 * this.noiseB(x * 2.3, y * 2.3, z * 2.3));
  }

  innerR(x, y, z) {
    return this.outerR(x, y, z) - this.rindT(x, y, z);
  }

  point(Rfn, theta, phi, out) {
    const st = Math.sin(theta);
    const dx = st * Math.cos(phi);
    const dy = Math.cos(theta);
    const dz = st * Math.sin(phi);
    const R = Rfn(dx, dy, dz);
    return out.set(dx * R, dy * R, dz * R);
  }

  // Surface normal of a radial surface r = R(d) * d, by finite differences.
  normalAt(Rfn, dx, dy, dz, out) {
    let tx, ty, tz;
    if (Math.abs(dy) < 0.9) {
      const l = Math.hypot(dz, dx);
      tx = dz / l; ty = 0; tz = -dx / l;
    } else {
      const l = Math.hypot(dz, dy);
      tx = 0; ty = -dz / l; tz = dy / l;
    }
    const ux = dy * tz - dz * ty;
    const uy = dz * tx - dx * tz;
    const uz = dx * ty - dy * tx;
    const e = 1.5e-3;
    const R0 = Rfn(dx, dy, dz);
    const p0x = dx * R0, p0y = dy * R0, p0z = dz * R0;
    let ax = dx + e * tx, ay = dy + e * ty, az = dz + e * tz;
    let l = Math.hypot(ax, ay, az);
    ax /= l; ay /= l; az /= l;
    const R1 = Rfn(ax, ay, az);
    const e1x = ax * R1 - p0x, e1y = ay * R1 - p0y, e1z = az * R1 - p0z;
    let bx = dx + e * ux, by = dy + e * uy, bz = dz + e * uz;
    l = Math.hypot(bx, by, bz);
    bx /= l; by /= l; bz /= l;
    const R2 = Rfn(bx, by, bz);
    const e2x = bx * R2 - p0x, e2y = by * R2 - p0y, e2z = bz * R2 - p0z;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (nx * dx + ny * dy + nz * dz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    return out.set(nx, ny, nz);
  }

  // Polar angle at which the surface crosses the tear height h.
  thetaRim(Rfn, phi, h) {
    let lo = Math.PI / 2 - 0.5;
    let hi = Math.PI / 2 + 0.5;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    for (let it = 0; it < 32; it++) {
      const mid = 0.5 * (lo + hi);
      const st = Math.sin(mid);
      const dy = Math.cos(mid);
      const y = Rfn(st * c, dy, st * s) * dy;
      if (y > h) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  rimInnerRadiusAt(phi) {
    const f = ((((phi % TAU) + TAU) % TAU) / TAU) * this.segPhi;
    const i0 = Math.floor(f) % this.segPhi;
    const i1 = (i0 + 1) % this.segPhi;
    const t = f - Math.floor(f);
    const r0 = Math.hypot(this.rimInner[i0].x, this.rimInner[i0].z);
    const r1 = Math.hypot(this.rimInner[i1].x, this.rimInner[i1].z);
    return r0 + (r1 - r0) * t;
  }

  // Height of the exposed pulp surface of one half, at radial fraction rho.
  // Only the broad waves of the tear reach into the pulp; the jagged detail is
  // confined to the rim so it cannot crease the surface near the centre.
  crackYSmooth(phi) {
    let s = 0;
    for (const t of this.crackTerms) if (t.k <= 3) s += t.amp * Math.sin(t.k * phi + t.ph);
    return s;
  }

  jellyY(rho, phi, x, z, side) {
    const r2 = rho * rho;
    const hs = this.crackYSmooth(phi);
    const jag = (this.crackY(phi) - hs) * Math.pow(rho, 12);
    return (
      hs * r2 +
      jag +
      side * (0.04 * r2 * r2 - 0.004 * (1 - r2)) +
      side * (0.007 * this.noiseC(x * 2.6 + 11, z * 2.6, side * 3.3) + 0.0025 * this.noiseC(x * 7 - 3, z * 7, side * 5.1)) * (1 - r2 * r2)
    );
  }

  jellyYAt(x, z, side) {
    const phi = Math.atan2(z, x);
    const rho = Math.min(1, Math.hypot(x, z) / this.rimInnerRadiusAt(phi));
    return this.jellyY(rho, phi, x, z, side);
  }

  // ---------------------------------------------------------------- geometry

  buildShell(Rfn, thetaArr, side, segV, { inward = false, uvX = 0 } = {}) {
    const segPhi = this.segPhi;
    const cols = segPhi + 1;
    const rows = segV + 1;
    const pos = new Float32Array(cols * rows * 3);
    const nor = new Float32Array(cols * rows * 3);
    const uv = new Float32Array(cols * rows * 2);
    const n = new THREE.Vector3();
    let vi = 0;
    for (let j = 0; j < rows; j++) {
      const v = j / segV;
      for (let i = 0; i < cols; i++) {
        const ii = i % segPhi;
        const phi = (ii / segPhi) * TAU;
        const tr = thetaArr[ii];
        const theta = side > 0 ? v * tr : tr + v * (Math.PI - tr);
        const st = Math.sin(theta);
        const dx = st * Math.cos(phi);
        const dy = Math.cos(theta);
        const dz = st * Math.sin(phi);
        const R = Rfn(dx, dy, dz);
        pos[vi * 3] = dx * R;
        pos[vi * 3 + 1] = dy * R;
        pos[vi * 3 + 2] = dz * R;
        this.normalAt(Rfn, dx, dy, dz, n);
        if (inward) n.negate();
        nor[vi * 3] = n.x;
        nor[vi * 3 + 1] = n.y;
        nor[vi * 3 + 2] = n.z;
        uv[vi * 2] = uvX;
        // For the cavity lining, v carries how far this point sits below the
        // exposed pulp: the rind there is buried in juice and barely lit.
        uv[vi * 2 + 1] = inward ? Math.max(0, side * (dy * R - this.crackYSmooth(phi)) - 0.04) : 0;
        vi++;
      }
    }
    const idx = [];
    for (let j = 0; j < segV; j++) {
      for (let i = 0; i < segPhi; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        if (!inward) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }

  // The torn cross-section of the rind: purple skin line, blush, white pith.
  buildRimStrip(side) {
    const segPhi = this.segPhi;
    const K = 7;
    const cols = segPhi + 1;
    const rows = K + 1;
    const pos = new Float32Array(cols * rows * 3);
    const uv = new Float32Array(cols * rows * 2);
    let vi = 0;
    for (let k = 0; k < rows; k++) {
      const s = Math.pow(k / K, 1.3);
      for (let i = 0; i < cols; i++) {
        const ii = i % segPhi;
        const phi = (ii / segPhi) * TAU;
        const po = this.rimOuter[ii];
        const pi = this.rimInner[ii];
        const cx = Math.cos(phi);
        const cz = Math.sin(phi);
        const tear =
          Math.sin(Math.PI * s) *
          (0.011 * this.noiseC(cx * 2.7, cz * 2.7, s * 2.1 + 0.5) + 0.0045 * this.noiseC(cx * 8.3, cz * 8.3, s * 5.2 + 7));
        pos[vi * 3] = po.x + (pi.x - po.x) * s;
        pos[vi * 3 + 1] = po.y + (pi.y - po.y) * s + tear;
        pos[vi * 3 + 2] = po.z + (pi.z - po.z) * s;
        uv[vi * 2] = s;
        uv[vi * 2 + 1] = 0;
        vi++;
      }
    }
    const idx = gridIndices(cols, rows, side > 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    weldSeamNormals(geo, cols, rows);
    geo.computeBoundingSphere();
    return geo;
  }

  // The exposed face of the pulp: a gently domed, lumpy jelly surface.
  buildJelly(side) {
    const segPhi = this.segPhi;
    const rings = 14;
    const cols = segPhi + 1;
    const count = 1 + rings * cols;
    const pos = new Float32Array(count * 3);
    pos[0] = 0;
    pos[1] = this.jellyY(0, 0, 0, 0, side);
    pos[2] = 0;
    let vi = 1;
    for (let r = 1; r <= rings; r++) {
      const rho = r / rings;
      for (let i = 0; i < cols; i++) {
        const ii = i % segPhi;
        const phi = (ii / segPhi) * TAU;
        const pi = this.rimInner[ii];
        const x = pi.x * rho;
        const z = pi.z * rho;
        pos[vi * 3] = x;
        pos[vi * 3 + 1] = this.jellyY(rho, phi, x, z, side);
        pos[vi * 3 + 2] = z;
        vi++;
      }
    }
    const idx = [];
    // Fan around the centre; (centre, i, i+1) faces -Y.
    for (let i = 0; i < segPhi; i++) {
      if (side > 0) idx.push(0, 1 + i, 2 + i);
      else idx.push(0, 2 + i, 1 + i);
    }
    for (let r = 0; r < rings - 1; r++) {
      for (let i = 0; i < segPhi; i++) {
        const a = 1 + r * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        // (a, b, c) faces +Y here.
        if (side > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
    // Normals straight from the height field: the fan's sliver triangles near
    // the centre would otherwise shade as a starburst.
    const nor = new Float32Array(count * 3);
    const e = 0.004;
    for (let i = 0; i < count; i++) {
      const x = pos[i * 3];
      const z = pos[i * 3 + 2];
      const dx = (this.jellyYAt(x + e, z, side) - this.jellyYAt(x - e, z, side)) / (2 * e);
      const dz = (this.jellyYAt(x, z + e, side) - this.jellyYAt(x, z - e, side)) / (2 * e);
      const l = Math.hypot(dx, 1, dz);
      nor[i * 3] = (side * dx) / l;
      nor[i * 3 + 1] = -side / l;
      nor[i * 3 + 2] = (side * dz) / l;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }

  // Where the stalk sits on the stem pole, and the fruit-frame point at its tip.
  stemPlacement() {
    const position = new THREE.Vector3(0, this.outerR(0, 1, 0) - 0.012, 0);
    const rotation = new THREE.Euler(0.05, 0.4, -0.2);
    const matrix = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), new THREE.Vector3(1, 1, 1));
    const tip = new THREE.Vector3(0, 0.25, 0).applyMatrix4(matrix);
    return { position, rotation, tip };
  }

  buildStem() {
    const profile = [
      [0.0, -0.04], [0.1, -0.04], [0.099, -0.014], [0.088, 0.005], [0.07, 0.021], [0.054, 0.04],
      [0.044, 0.064], [0.039, 0.1], [0.037, 0.15], [0.036, 0.2], [0.039, 0.226], [0.042, 0.236],
      [0.036, 0.245], [0.02, 0.249], [0.0, 0.25],
    ];
    const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 28);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color('#56642a');
    const mid = new THREE.Color('#6c6834');
    const tip = new THREE.Color('#9a825a');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      c.copy(base).lerp(mid, THREE.MathUtils.smoothstep(y, 0.02, 0.14));
      c.lerp(tip, THREE.MathUtils.smoothstep(y, 0.215, 0.24));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }

  buildArilGeometry(variant, segments = [22, 16]) {
    const geo = new THREE.SphereGeometry(1, segments[0], segments[1]);
    const noise = createNoise3D(mulberry32(this.seed * 31 + variant * 7 + 3));
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      const lump = 1 + 0.06 * noise(x * 1.3, y * 1.3, z * 1.3) + 0.012 * noise(x * 3.1 + 3, y * 3.1, z * 3.1);
      // teardrop: the sac narrows toward where it hung from the rind
      const tip = x < 0 ? 1 + 0.2 * x * x : 1;
      x *= lump * tip;
      y *= lump;
      z *= lump;
      pos.setXYZ(i, x * ARIL_RADII.x, y * ARIL_RADII.y, z * ARIL_RADII.z);
    }
    geo.computeVertexNormals();
    return geo;
  }

  buildSeedGeometry(segments = [16, 10]) {
    const geo = new THREE.SphereGeometry(1, segments[0], segments[1]);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const taper = 1 - 0.18 * Math.max(0, x); // slightly pointed at one end
      x *= 1 + 0.08 * x * x;
      pos.setXYZ(i, x * SEED_RADII.x, y * SEED_RADII.y * taper, z * SEED_RADII.z * taper);
    }
    geo.computeVertexNormals();
    return geo;
  }

  // Aril and seed transforms for one half, in the fruit frame.
  placePulp(side) {
    const rand = mulberry32(this.seed * 13 + (side > 0 ? 101 : 202));
    const arils = [];
    const seeds = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const m = new THREE.Matrix4();

    const randomQuat = (out) => {
      // uniform random rotation (Shoemake)
      const u1 = rand(), u2 = rand() * TAU, u3 = rand() * TAU;
      const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
      return out.set(a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3));
    };

    const poisson = (minD, maxCount, margin, tries) => {
      const pts = [];
      for (let t = 0; t < tries && pts.length < maxCount; t++) {
        const ang = rand() * TAU;
        const r = Math.sqrt(rand()) * 0.9;
        if (r > this.rimInnerRadiusAt(ang) - margin) continue;
        const x = r * Math.cos(ang);
        const z = r * Math.sin(ang);
        let ok = true;
        for (const o of pts) {
          if ((o.x - x) ** 2 + (o.z - z) ** 2 < minD * minD) { ok = false; break; }
        }
        if (ok) pts.push({ x, z });
      }
      return pts;
    };

    // Top layer: juice sacs poking out of the jelly, each around a seed.
    for (const { x, z } of poisson(0.155, 130, 0.075, 14000)) {
      const y = this.jellyYAt(x, z, side) + side * (0.005 + 0.035 * rand());
      p.set(x, y, z);
      randomQuat(q);
      const k = 0.82 + 0.3 * rand();
      s.set(k * (0.92 + 0.16 * rand()), k * (0.9 + 0.2 * rand()), k * (0.92 + 0.16 * rand()));
      m.compose(p, q, s);
      const tint = rand();
      arils.push({ matrix: m.clone(), tint });
      const seedM = m.clone().multiply(
        new THREE.Matrix4().compose(
          new THREE.Vector3((rand() - 0.5) * 0.02, (rand() - 0.5) * 0.01, (rand() - 0.5) * 0.02),
          new THREE.Quaternion().setFromEuler(e.set((rand() - 0.5) * 0.3, (rand() - 0.5) * 0.4, (rand() - 0.5) * 0.3)),
          new THREE.Vector3(0.92, 0.92, 0.92).multiplyScalar(0.94 + 0.1 * rand()),
        ),
      );
      seeds.push(seedM);
    }

    // Deeper seeds, seen through the jelly.
    for (const { x, z } of poisson(0.19, 70, 0.07, 6000)) {
      const y = this.jellyYAt(x, z, side) + side * (0.06 + 0.08 * rand());
      p.set(x, y, z);
      randomQuat(q);
      const k = 0.85 + 0.25 * rand();
      s.set(k, k, k);
      seeds.push(new THREE.Matrix4().compose(p, q, s));
    }
    return { arils, seeds };
  }

  // Mass, centre of mass and inertia tensor (fruit axes, about the COM) by sampling.
  massProperties(side) {
    const rand = mulberry32(4242 + (side + 2) * 17);
    const N = 70000;
    const box = { x: 1.08, y: 1.16, z: 1.08 };
    const pts = [];
    const com = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const x = (rand() * 2 - 1) * box.x;
      const y = (rand() * 2 - 1) * box.y;
      const z = (rand() * 2 - 1) * box.z;
      const r = Math.hypot(x, y, z);
      if (r < 1e-6) continue;
      if (r > this.outerR(x / r, y / r, z / r)) continue;
      if (side !== 0 && side * (y - this.crackY(Math.atan2(z, x))) < 0) continue;
      pts.push(x, y, z);
      com.x += x;
      com.y += y;
      com.z += z;
    }
    const n = pts.length / 3;
    com.divideScalar(n);
    const cellMass = (8 * box.x * box.y * box.z) / N; // unit density
    const mass = n * cellMass;
    let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i] - com.x;
      const y = pts[i + 1] - com.y;
      const z = pts[i + 2] - com.z;
      ixx += y * y + z * z;
      iyy += x * x + z * z;
      izz += x * x + y * y;
      ixy -= x * y;
      ixz -= x * z;
      iyz -= y * z;
    }
    const inertia = new THREE.Matrix3().set(ixx, ixy, ixz, ixy, iyy, iyz, ixz, iyz, izz).multiplyScalar(cellMass);
    return { mass, com, inertia };
  }
}

// Quad-grid indices for a (cols x rows) vertex grid; flip reverses winding.
function gridIndices(cols, rows, flipFirst) {
  const idx = [];
  for (let k = 0; k < rows - 1; k++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = k * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (flipFirst) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  return idx;
}

// The first and last column of a wrapped grid share positions; average their normals.
function weldSeamNormals(geo, cols, rows, offset = 0) {
  const n = geo.attributes.normal;
  const v = new THREE.Vector3();
  for (let k = 0; k < rows; k++) {
    const a = offset + k * cols;
    const b = a + cols - 1;
    v.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z);
    n.setXYZ(b, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
}
