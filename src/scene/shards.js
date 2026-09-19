import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise3D, mulberry32 } from './noise.js';
import { FRUIT_DIMS } from './fruitModel.js';

// How far across the torn wall each row sits, from the skin (0) to the pith (1).
const WALL_ROWS = [0, 0.12, 0.4, 0.75, 1];
const MAX_CONTACTS = 34;

// Breaks the rind into torn pieces for the explosion. The sphere of
// directions is divided into warped, weighted Voronoi cells; each cell is cut
// out of a fine geodesic mesh along the zero line of its distance field, so
// the edges follow the noise rather than the triangles. Every connected piece
// becomes a shard: skin outside, pith inside and a torn wall between them,
// all in the fruit frame so the skin pattern lines up with the whole fruit.
export function buildShards(model, { count = 24, seed = 5, detail = 40, minArea = 0.008 } = {}) {
  const rand = mulberry32(seed);
  const nx = createNoise3D(rand);
  const ny = createNoise3D(rand);
  const nz = createNoise3D(rand);

  const centres = [new THREE.Vector3(0.24, 1, 0.12).normalize()]; // keeps the stalk inside one piece
  const minAngle = 0.62 * Math.sqrt((4 * Math.PI) / count);
  for (let tries = 0; centres.length < count && tries < 40000; tries++) {
    const v = randomUnit(rand, new THREE.Vector3());
    const need = tries > 20000 ? minAngle * 0.7 : minAngle;
    if (centres.every((c) => c.angleTo(v) > need)) centres.push(v);
  }
  const N = centres.length;
  const weights = centres.map(() => 0.72 + 0.56 * rand());

  let base = new THREE.IcosahedronGeometry(1, detail);
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  base = mergeVertices(base, 1e-5);
  const P = base.attributes.position;
  const tri = base.index.array;
  const V = P.count;

  const dirs = new Float32Array(V * 3);
  const dist = new Float32Array(V * N);
  const best = new Int32Array(V);
  const d1 = new Float32Array(V);
  const d2 = new Float32Array(V);
  const w = new THREE.Vector3();
  for (let v = 0; v < V; v++) {
    const x = P.getX(v), y = P.getY(v), z = P.getZ(v);
    const l = Math.hypot(x, y, z);
    dirs[v * 3] = x / l;
    dirs[v * 3 + 1] = y / l;
    dirs[v * 3 + 2] = z / l;
    warp(x / l, y / l, z / l, w);
    let b = -1, m1 = Infinity, m2 = Infinity;
    for (let c = 0; c < N; c++) {
      const d = Math.acos(THREE.MathUtils.clamp(w.dot(centres[c]), -1, 1)) / weights[c];
      dist[v * N + c] = d;
      if (d < m1) { m2 = m1; m1 = d; b = c; } else if (d < m2) m2 = d;
    }
    best[v] = b;
    d1[v] = m1;
    d2[v] = m2;
  }

  function warp(x, y, z, out) {
    out.set(
      x + 0.2 * nx(x * 1.7, y * 1.7, z * 1.7) + 0.06 * nx(x * 5.3 + 9, y * 5.3, z * 5.3) + 0.016 * nx(x * 13 - 4, y * 13, z * 13),
      y + 0.2 * ny(x * 1.7, y * 1.7, z * 1.7) + 0.06 * ny(x * 5.3 + 9, y * 5.3, z * 5.3) + 0.016 * ny(x * 13 - 4, y * 13, z * 13),
      z + 0.2 * nz(x * 1.7, y * 1.7, z * 1.7) + 0.06 * nz(x * 5.3 + 9, y * 5.3, z * 5.3) + 0.016 * nz(x * 13 - 4, y * 13, z * 13),
    );
    return out.normalize();
  }

  // Positive inside cell c, zero on its border.
  const field = (c, v) => (best[v] === c ? d2[v] - d1[v] : d1[v] - dist[v * N + c]);

  // Pole vertex, to find which piece carries the stalk.
  let pole = 0;
  for (let v = 1; v < V; v++) if (dirs[v * 3 + 1] > dirs[pole * 3 + 1]) pole = v;

  const pieces = [];
  for (let c = 0; c < N; c++) {
    const keyDir = new Map(); // key -> unit direction
    const keyField = new Map(); // key -> how far inside the piece it sits
    const polys = [];
    const segs = [];
    const f = [0, 0, 0];
    const ids = [0, 0, 0];
    for (let t = 0; t < tri.length; t += 3) {
      ids[0] = tri[t]; ids[1] = tri[t + 1]; ids[2] = tri[t + 2];
      f[0] = field(c, ids[0]); f[1] = field(c, ids[1]); f[2] = field(c, ids[2]);
      if (f[0] < 0 && f[1] < 0 && f[2] < 0) continue;
      const out = [];
      const cross = [];
      for (let k = 0; k < 3; k++) {
        const a = ids[k], b = ids[(k + 1) % 3];
        const fa = f[k], fb = f[(k + 1) % 3];
        if (fa >= 0) {
          out.push(a);
          if (!keyDir.has(a)) {
            keyDir.set(a, new THREE.Vector3(dirs[a * 3], dirs[a * 3 + 1], dirs[a * 3 + 2]));
            keyField.set(a, fa);
          }
        }
        if (fa >= 0 !== fb >= 0) {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          const key = V + lo * V + hi;
          if (!keyDir.has(key)) {
            const flo = lo === a ? fa : fb;
            const fhi = lo === a ? fb : fa;
            const s = flo / (flo - fhi);
            keyDir.set(key, new THREE.Vector3(
              dirs[lo * 3] + (dirs[hi * 3] - dirs[lo * 3]) * s,
              dirs[lo * 3 + 1] + (dirs[hi * 3 + 1] - dirs[lo * 3 + 1]) * s,
              dirs[lo * 3 + 2] + (dirs[hi * 3 + 2] - dirs[lo * 3 + 2]) * s,
            ).normalize());
            keyField.set(key, 0);
          }
          out.push(key);
          cross.push(out.length - 1);
        }
      }
      polys.push(out);
      if (cross.length === 2) {
        // The border runs between the two crossings that sit next to each other.
        const [i, j] = cross;
        if (j === i + 1) segs.push([out[i], out[j]]);
        else segs.push([out[j], out[i]]);
      }
    }
    if (!polys.length) continue;

    // Split into connected pieces.
    const parent = new Map();
    const find = (k) => {
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r);
      let x = k;
      while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
      return r;
    };
    for (const k of keyDir.keys()) parent.set(k, k);
    for (const p of polys) for (let i = 1; i < p.length; i++) {
      const a = find(p[0]), b = find(p[i]);
      if (a !== b) parent.set(a, b);
    }
    const groups = new Map();
    for (const p of polys) {
      const r = find(p[0]);
      if (!groups.has(r)) groups.set(r, { polys: [], segs: [] });
      groups.get(r).polys.push(p);
    }
    for (const s of segs) groups.get(find(s[0])).segs.push(s);
    for (const g of groups.values()) pieces.push({ ...g, keyDir, keyField, hasStem: g.polys.some((p) => p.includes(pole)) });
  }

  const shards = [];
  for (const piece of pieces) {
    const shard = buildPiece(model, piece, nx);
    if (shard.area < minArea && !piece.hasStem) {
      shard.geometry.dispose();
      continue;
    }
    shards.push(shard);
  }
  base.dispose();
  return shards;
}

// Rind tears thin: a piece keeps its full thickness in the middle and feathers
// away to almost nothing at the torn edge, so it reads as peel, not a tile.
const taper = (f) => 0.22 + 0.78 * THREE.MathUtils.smoothstep(f, 0, 0.055);

function buildPiece(model, { polys, segs, keyDir, keyField, hasStem }, noise) {
  const local = new Map();
  const keys = [];
  const use = (k) => {
    let i = local.get(k);
    if (i === undefined) {
      i = keys.length;
      local.set(k, i);
      keys.push(k);
    }
    return i;
  };
  const faces = [];
  for (const p of polys) for (let i = 1; i < p.length - 1; i++) faces.push(use(p[0]), use(p[i]), use(p[i + 1]));
  const nK = keys.length;

  const border = new Map(); // key -> first wall vertex
  const borderKeys = [];
  for (const [a, b] of segs) for (const k of [a, b]) if (!border.has(k)) { border.set(k, 0); borderKeys.push(k); }
  const R = WALL_ROWS.length;
  const total = nK * 2 + borderKeys.length * R;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const n = new THREE.Vector3();

  const outerAt = [];
  const innerAt = [];
  for (let i = 0; i < nK; i++) {
    const d = keyDir.get(keys[i]);
    const ro = model.outerR(d.x, d.y, d.z);
    const ri = ro - (ro - model.innerR(d.x, d.y, d.z)) * taper(keyField.get(keys[i]) ?? 1);
    outerAt.push(d.clone().multiplyScalar(ro));
    innerAt.push(d.clone().multiplyScalar(ri));
    pos.set([d.x * ro, d.y * ro, d.z * ro], i * 3);
    model.normalAt(model.outerR, d.x, d.y, d.z, n);
    nor.set([n.x, n.y, n.z], i * 3);
    const j = nK + i;
    pos.set([d.x * ri, d.y * ri, d.z * ri], j * 3);
    model.normalAt(model.innerR, d.x, d.y, d.z, n);
    nor.set([-n.x, -n.y, -n.z], j * 3);
    uv[j * 2] = 1;
  }

  const wallStart = nK * 2;
  borderKeys.forEach((k, bi) => {
    border.set(k, wallStart + bi * R);
    const li = local.get(k);
    for (let r = 0; r < R; r++) {
      const v = wallStart + bi * R + r;
      const s = WALL_ROWS[r];
      const o = outerAt[li], q = innerAt[li];
      pos.set([o.x + (q.x - o.x) * s, o.y + (q.y - o.y) * s, o.z + (q.z - o.z) * s], v * 3);
      uv[v * 2] = s;
    }
  });

  const index = [...faces];
  for (let i = 0; i < faces.length; i += 3) index.push(nK + faces[i], nK + faces[i + 2], nK + faces[i + 1]);
  const skinCount = faces.length;
  const wallIndex = [];
  for (const [a, b] of segs) {
    const pa = border.get(a), pb = border.get(b);
    for (let r = 0; r < R - 1; r++) {
      wallIndex.push(pa + r, pb + r + 1, pb + r, pa + r, pa + r + 1, pb + r + 1);
    }
  }

  // Torn pith is lumpy: push the middle of the wall in and out along its normal.
  accumulateNormals(pos, wallIndex, nor, wallStart, total);
  for (let v = wallStart; v < total; v++) {
    const s = uv[v * 2];
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const bump = Math.sin(Math.PI * s) * (0.008 * noise(x * 9, y * 9, z * 9) + 0.004 * noise(x * 23 + 5, y * 23, z * 23));
    pos[v * 3] += nor[v * 3] * bump;
    pos[v * 3 + 1] += nor[v * 3 + 1] * bump;
    pos[v * 3 + 2] += nor[v * 3 + 2] * bump;
  }
  accumulateNormals(pos, wallIndex, nor, wallStart, total);
  index.push(...wallIndex);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.addGroup(0, skinCount, 0);
  geometry.addGroup(skinCount, index.length - skinCount, 1);
  geometry.computeBoundingSphere();

  // A thin shell of rind: mass sits in the middle of its thickness.
  const com = new THREE.Vector3();
  const pts = [];
  let mass = 0;
  let area = 0;
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), mid = new THREE.Vector3();
  for (let i = 0; i < faces.length; i += 3) {
    const a = outerAt[faces[i]], b = outerAt[faces[i + 1]], c = outerAt[faces[i + 2]];
    const A = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
    mid.addVectors(a, b).add(c).divideScalar(3);
    mid.multiplyScalar(1 - (0.5 * FRUIT_DIMS.rind) / mid.length());
    const m = A * FRUIT_DIMS.rind;
    pts.push(mid.x, mid.y, mid.z, m);
    com.addScaledVector(mid, m);
    mass += m;
    area += A;
  }
  com.divideScalar(mass);
  let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
  for (let i = 0; i < pts.length; i += 4) {
    const x = pts[i] - com.x, y = pts[i + 1] - com.y, z = pts[i + 2] - com.z, m = pts[i + 3];
    ixx += m * (y * y + z * z);
    iyy += m * (x * x + z * z);
    izz += m * (x * x + y * y);
    ixy -= m * x * y;
    ixz -= m * x * z;
    iyz -= m * y * z;
  }
  // A floor on the inertia keeps slivers from spinning wildly.
  const floor = mass * 0.004;
  const inertia = new THREE.Matrix3().set(ixx + floor, ixy, ixz, ixy, iyy + floor, iyz, ixz, iyz, izz + floor);

  // Contact points: the skin anywhere, the pith only along the torn edge.
  const pool = [...outerAt];
  for (const k of borderKeys) pool.push(innerAt[local.get(k)]);
  const contacts = farthestPoints(pool, MAX_CONTACTS - (hasStem ? 1 : 0));

  const centre = new THREE.Vector3();
  for (const p of outerAt) centre.add(p);
  centre.divideScalar(outerAt.length);
  return { geometry, mass, com, inertia, contacts, hasStem, area, centre, inner: [nK, nK * 2] };
}

function accumulateNormals(pos, index, nor, start, end) {
  nor.fill(0, start * 3, end * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < index.length; i += 3) {
    const i0 = index[i], i1 = index[i + 1], i2 = index[i + 2];
    a.fromArray(pos, i0 * 3);
    b.fromArray(pos, i1 * 3).sub(a);
    c.fromArray(pos, i2 * 3).sub(a);
    b.cross(c);
    for (const v of [i0, i1, i2]) {
      nor[v * 3] += b.x;
      nor[v * 3 + 1] += b.y;
      nor[v * 3 + 2] += b.z;
    }
  }
  for (let v = start; v < end; v++) {
    const l = Math.hypot(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]) || 1;
    nor[v * 3] /= l;
    nor[v * 3 + 1] /= l;
    nor[v * 3 + 2] /= l;
  }
}

function farthestPoints(points, k) {
  const picked = [];
  const d = new Float32Array(points.length).fill(Infinity);
  let next = 0;
  for (let n = 0; n < Math.min(k, points.length); n++) {
    const p = points[next];
    picked.push(p.clone());
    let far = 0;
    let farD = -1;
    for (let i = 0; i < points.length; i++) {
      const dd = points[i].distanceToSquared(p);
      if (dd < d[i]) d[i] = dd;
      if (d[i] > farD) { farD = d[i]; far = i; }
    }
    next = far;
  }
  return picked;
}

function randomUnit(rand, out) {
  const z = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(t), z, r * Math.sin(t));
}
