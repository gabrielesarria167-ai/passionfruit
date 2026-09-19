import * as THREE from 'three';

// A small impulse-based rigid-body solver for curved bodies resting on the
// ground plane y = 0. Each body supplies its own contact candidates (points in
// the fruit frame), so the dome of a half can be an exact ellipsoid support
// point and roll smoothly instead of bumping over sampled vertices.

const UP = new THREE.Vector3(0, 1, 0);
const _m4 = new THREE.Matrix4();
const _rT = new THREE.Matrix3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _v = new THREE.Vector3();
const _j = new THREE.Vector3();
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)];

export class RigidBody {
  constructor({ mass, inertia, com }) {
    this.mass = mass;
    this.invMass = 1 / mass;
    this.invInertiaBody = inertia.clone().invert();
    this.com = com.clone(); // centre of mass in the fruit frame
    this.pos = new THREE.Vector3(); // world position of the COM
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.rot = new THREE.Matrix3();
    this.invInertiaWorld = new THREE.Matrix3();
    this.sleeping = false;
    this.restTime = 0;
    this.contactCandidates = null; // (body, outArray of fruit-frame Vector3) => void
    this.inContact = false;
    this._cands = [];
    this._contacts = [];
    for (let i = 0; i < 64; i++) this._contacts.push({ r: new THREE.Vector3(), depth: 0, jn: 0, jt: [0, 0], bias: 0, kN: 0, kT: [0, 0] });
  }

  updateDerived() {
    _m4.makeRotationFromQuaternion(this.quat);
    this.rot.setFromMatrix4(_m4);
    _rT.copy(this.rot).transpose();
    this.invInertiaWorld.copy(this.rot).multiply(this.invInertiaBody).multiply(_rT);
  }

  // Fruit-frame point to world space.
  fruitToWorld(p, out) {
    return out.copy(p).sub(this.com).applyMatrix3(this.rot).add(this.pos);
  }

  // Direction of world "down" expressed in the fruit frame.
  downInFruit(out) {
    _rT.copy(this.rot).transpose();
    return out.set(0, -1, 0).applyMatrix3(_rT);
  }

  velocityAt(r, out) {
    return out.copy(this.angVel).cross(r).add(this.vel);
  }

  applyImpulse(j, r) {
    this.vel.addScaledVector(j, this.invMass);
    _a.copy(r).cross(j).applyMatrix3(this.invInertiaWorld);
    this.angVel.add(_a);
  }

  effectiveMass(r, dir) {
    _a.copy(r).cross(dir).applyMatrix3(this.invInertiaWorld).cross(r);
    return this.invMass + dir.dot(_a);
  }

  integrate(dt) {
    this.pos.addScaledVector(this.vel, dt);
    integrateQuat(this.quat, this.angVel, dt);
  }

  wake() {
    this.sleeping = false;
    this.restTime = 0;
  }
}

export function integrateQuat(q, w, dt) {
  const hx = w.x * dt * 0.5;
  const hy = w.y * dt * 0.5;
  const hz = w.z * dt * 0.5;
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  q.x = qx + hx * qw + hy * qz - hz * qy;
  q.y = qy + hy * qw + hz * qx - hx * qz;
  q.z = qz + hz * qw + hx * qy - hy * qx;
  q.w = qw - hx * qx - hy * qy - hz * qz;
  q.normalize();
}

export class GroundWorld {
  constructor({ gravity = 16, restitution = 0.18, friction = 0.65, iterations = 10 } = {}) {
    this.gravity = gravity;
    this.restitution = restitution;
    this.friction = friction;
    this.iterations = iterations;
    this.slop = 0.004;
    this.rollingDamping = 3;
    this.settleDamping = 7;
    this.spinDamping = 4.0;
    this.linearDamping = 0.6;
  }

  gatherContacts(body) {
    const cands = body._cands;
    cands.length = 0;
    body.contactCandidates(body, cands);
    let n = 0;
    for (const p of cands) {
      body.fruitToWorld(p, _b);
      if (_b.y < this.slop && n < body._contacts.length) {
        const c = body._contacts[n++];
        c.r.copy(_b).sub(body.pos);
        c.depth = -_b.y;
      }
    }
    return n;
  }

  lowestPoint(body) {
    const cands = body._cands;
    cands.length = 0;
    body.contactCandidates(body, cands);
    let minY = Infinity;
    for (const p of cands) {
      body.fruitToWorld(p, _b);
      if (_b.y < minY) minY = _b.y;
    }
    return minY;
  }

  step(bodies, dt) {
    for (const body of bodies) {
      if (body.sleeping) continue;
      body.vel.y -= this.gravity * dt;
      body.updateDerived();
      const n = this.gatherContacts(body);
      body.inContact = n > 0;

      for (let i = 0; i < n; i++) {
        const c = body._contacts[i];
        c.jn = 0;
        c.jt[0] = 0;
        c.jt[1] = 0;
        c.kN = body.effectiveMass(c.r, UP);
        c.kT[0] = body.effectiveMass(c.r, AXES[0]);
        c.kT[1] = body.effectiveMass(c.r, AXES[1]);
        const vn = body.velocityAt(c.r, _v).y;
        c.bias = vn < -0.9 ? -this.restitution * vn : 0;
      }

      for (let it = 0; it < this.iterations; it++) {
        for (let i = 0; i < n; i++) {
          const c = body._contacts[i];
          body.velocityAt(c.r, _v);
          let dj = (c.bias - _v.y) / c.kN;
          const jn = Math.max(c.jn + dj, 0);
          dj = jn - c.jn;
          c.jn = jn;
          if (dj !== 0) body.applyImpulse(_j.set(0, dj, 0), c.r);

          const maxF = this.friction * c.jn;
          for (let k = 0; k < 2; k++) {
            body.velocityAt(c.r, _v);
            const vt = k === 0 ? _v.x : _v.z;
            let djt = -vt / c.kT[k];
            const jt = THREE.MathUtils.clamp(c.jt[k] + djt, -maxF, maxF);
            djt = jt - c.jt[k];
            c.jt[k] = jt;
            if (djt !== 0) body.applyImpulse(k === 0 ? _j.set(djt, 0, 0) : _j.set(0, 0, djt), c.r);
          }
        }
      }

      if (n > 0) {
        const damp = Math.exp(-this.rollingDamping * dt);
        body.angVel.x *= damp;
        body.angVel.z *= damp;
        body.angVel.y *= Math.exp(-this.spinDamping * dt);
        const ld = Math.exp(-this.linearDamping * dt);
        body.vel.x *= ld;
        body.vel.z *= ld;
      }

      body.integrate(dt);
      body.updateDerived();

      // Resolve any remaining penetration directly.
      const minY = this.lowestPoint(body);
      if (minY < 0) {
        body.pos.y -= minY;
        if (body.vel.y < 0 && minY < -0.002) body.vel.y *= 0.5;
      }

      // Fruit is soft: once a body is nearly still, the skin grips and it
      // settles instead of creeping.
      if (body.inContact && body.vel.lengthSq() < 0.01 && body.angVel.lengthSq() < 0.09) {
        body.restTime += dt;
        const grip = Math.exp(-this.settleDamping * Math.min(1, body.restTime / 0.3) * dt);
        body.vel.multiplyScalar(grip);
        body.angVel.multiplyScalar(grip);
        if (body.restTime > 0.8) {
          body.sleeping = true;
          body.vel.set(0, 0, 0);
          body.angVel.set(0, 0, 0);
        }
      } else {
        body.restTime = 0;
      }
    }
  }
}

// Lowest point of an axis-aligned ellipsoid (semi-axes a, b, a in the fruit
// frame, centred on the fruit origin) along a fruit-frame direction d.
export function ellipsoidSupport(a, b, d, out) {
  const sx = a * a * d.x;
  const sy = b * b * d.y;
  const sz = a * a * d.z;
  const k = Math.sqrt(a * a * d.x * d.x + b * b * d.y * d.y + a * a * d.z * d.z) || 1;
  return out.set(sx / k, sy / k, sz / k);
}

