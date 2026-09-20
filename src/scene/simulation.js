import * as THREE from 'three';
import { RigidBody, GroundWorld, ellipsoidSupport, integrateQuat } from './physics.js';

export const GRAVITY = 16;
export const STEP = 1 / 480;

const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();

// Tuning for the moment the fruit gives way.
export const SPLIT = {
  separation: 0.45, // push apart along the tear normal
  openSpin: 1.15, // rad/s rolling each half onto its back
  rebound: 0.06, // share of the impact speed that bounces back
};

// Tuning for the burst.
export const EXPLODE = {
  speed: 3.1, // outward speed of the rind pieces
  lift: 6.8, // upward kick: the burst throws everything skyward
  spin: 7, // rad/s tumble
};

// The rigid-body side of the drop: one whole fruit that falls, then either
// bursts into rind shards or tears into two halves.
export class FruitSimulation {
  constructor(model, shards) {
    this.model = model;
    this.world = new GroundWorld({ gravity: GRAVITY });
    this.stemTip = model.stemPlacement().tip;
    this.halves = [1, -1].map((side) => ({ side, body: this._halfBody(side) }));
    this.shards = shards.map((shard) => ({ shard, body: this._shardBody(shard) }));
    this.whole = this._wholeBody();
    this.mode = 'explode';
    this.bodies = [];
    this.phase = 'idle';
    this.lowestY = Infinity;
    this.onSplit = null;
  }

  _wholeBody() {
    const { model } = this;
    const body = new RigidBody(model.massProperties(0));
    const support = new THREE.Vector3();
    const down = new THREE.Vector3();
    body.contactCandidates = (b, out) => {
      b.downInFruit(down);
      out.push(ellipsoidSupport(model.collider.a, model.collider.b, down, support));
      out.push(this.stemTip);
    };
    return body;
  }

  _halfBody(side) {
    const { model } = this;
    const body = new RigidBody(model.massProperties(side));
    // Points standing in for the pulp that bulges past the rim, so a half that
    // lands face down rests on its pulp rather than sinking through the floor.
    const caps = [new THREE.Vector3(0, -side * 0.2, 0)];
    for (let i = 0; i < 6; i++) {
      const t = (i / 6) * Math.PI * 2;
      caps.push(new THREE.Vector3(Math.cos(t) * 0.5, -side * 0.17, Math.sin(t) * 0.5));
      caps.push(new THREE.Vector3(Math.cos(t + 0.5) * 0.78, -side * 0.12, Math.sin(t + 0.5) * 0.78));
    }
    const support = new THREE.Vector3();
    const down = new THREE.Vector3();
    body.contactCandidates = (b, out) => {
      b.downInFruit(down);
      ellipsoidSupport(model.collider.a, model.collider.b, down, support);
      if (side * (support.y - model.crackY(Math.atan2(support.z, support.x))) >= 0) out.push(support);
      for (const p of model.rimSamples) out.push(p);
      for (const p of caps) out.push(p);
      if (side > 0) out.push(this.stemTip);
    };
    return body;
  }

  _shardBody(shard) {
    const body = new RigidBody(shard);
    const points = shard.hasStem ? [...shard.contacts, this.stemTip] : shard.contacts;
    body.contactCandidates = (b, out) => {
      for (const p of points) out.push(p);
    };
    return body;
  }

  placeWhole(pos, quat) {
    const w = this.whole;
    w.pos.copy(pos);
    w.quat.copy(quat);
    w.vel.set(0, 0, 0);
    w.angVel.set(0, 0, 0);
    w.updateDerived();
  }

  // Orientation at the moment of impact: stalk axis lying almost flat, so the
  // tear stands vertical and the halves fall away from each other.
  impactOrientation({ azimuth, tilt = -0.05, roll = 0.3 }) {
    const axis = new THREE.Vector3(Math.cos(azimuth), tilt, -Math.sin(azimuth)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, axis);
    return q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, roll * Math.PI * 2));
  }

  // Sets up a fall from startHeight that meets the ground in qImpact while
  // tumbling at a constant angular velocity.
  prepareDrop({ qImpact, spin, startHeight, mode = 'explode', rand = Math.random, power = 1 }) {
    this.mode = mode;
    this.rand = rand;
    this.power = power;
    // Torn rind grips the floor and barely bounces, so pieces stay where they
    // land instead of rocking over onto their backs.
    this.world.rollingDamping = mode === 'explode' ? 11 : 3;
    this.world.friction = mode === 'explode' ? 0.88 : 0.65;
    this.world.restitution = mode === 'explode' ? 0.06 : 0.18;
    this.bodies = (mode === 'split' ? this.halves : this.shards).map((p) => p.body);
    for (const b of this.bodies) {
      b.sleeping = false;
      b.restTime = 0;
      b.vel.set(0, 0, 0);
      b.angVel.set(0, 0, 0);
    }
    this.placeWhole(ORIGIN, qImpact);
    const contactY = -this.world.lowestPoint(this.whole);
    const fall = Math.sqrt((2 * Math.max(0.01, startHeight - contactY)) / GRAVITY);
    const qStart = new THREE.Quaternion()
      .setFromAxisAngle(spin.clone().normalize(), -spin.length() * fall)
      .multiply(qImpact);
    this.placeWhole(new THREE.Vector3(0, startHeight, 0), qStart);
    this.whole.angVel.copy(spin);
    this.phase = 'falling';
    this.lowestY = Infinity;
    return fall;
  }

  split() {
    const w = this.whole;
    w.updateDerived();
    const impact = w.vel.clone();
    // Most of the energy goes into bruising the fruit; a little bounces back.
    w.vel.set(impact.x * 0.3, Math.min(0.9, -impact.y * SPLIT.rebound), impact.z * 0.3);
    w.angVel.multiplyScalar(0.2);

    const normal = new THREE.Vector3(0, 1, 0).applyMatrix3(w.rot).normalize();
    const r = new THREE.Vector3();
    const out = new THREE.Vector3();
    const axis = new THREE.Vector3();
    for (const h of this.halves) {
      const b = h.body;
      b.quat.copy(w.quat);
      w.fruitToWorld(b.com, b.pos);
      r.copy(b.pos).sub(w.pos);
      b.vel.copy(w.angVel).cross(r).add(w.vel);
      out.copy(normal).multiplyScalar(h.side);
      b.vel.addScaledVector(out, SPLIT.separation);
      b.vel.y += 0.2;
      b.angVel.copy(w.angVel);
      axis.crossVectors(out, UP);
      if (axis.lengthSq() > 1e-6) b.angVel.addScaledVector(axis.normalize(), -SPLIT.openSpin);
      b.wake();
      b.updateDerived();
    }
    this.phase = 'open';
    const center = w.fruitToWorld(ORIGIN, new THREE.Vector3());
    if (this.onSplit) this.onSplit({ center, normal, impactSpeed: -impact.y, mode: 'split' });
  }

  // The fruit bursts: the ground stops the bottom, everything else keeps going
  // and the rind tears into pieces that fly outward, up and tumbling.
  explode() {
    const w = this.whole;
    w.updateDerived();
    const impact = w.vel.clone();
    const rand = this.rand;
    const center = w.fruitToWorld(ORIGIN, new THREE.Vector3());
    const dir = new THREE.Vector3();
    const flat = new THREE.Vector3();
    const axis = new THREE.Vector3();
    for (const { body: b } of this.shards) {
      b.quat.copy(w.quat);
      w.fruitToWorld(b.com, b.pos);
      dir.copy(b.pos).sub(center).normalize();
      flat.set(dir.x, 0, dir.z);
      if (flat.lengthSq() < 1e-4) flat.set(rand() - 0.5, 0, rand() - 0.5);
      flat.normalize();
      const up = 0.5 + 0.5 * dir.y; // 0 underneath, 1 on top
      const speed = EXPLODE.speed * this.power * (0.65 + 0.7 * rand()) * (0.75 + 0.5 * (1 - Math.abs(dir.y)));
      b.vel.copy(flat).multiplyScalar(speed);
      b.vel.y = EXPLODE.lift * this.power * (0.45 + 0.7 * up) * (0.8 + 0.35 * rand());
      b.vel.x += impact.x * 0.3;
      b.vel.z += impact.z * 0.3;
      // A little tip outward, mostly its own tumble, so the pieces come down
      // at every angle.
      axis.crossVectors(UP, flat).normalize();
      b.angVel.copy(axis).multiplyScalar(EXPLODE.spin * (0.1 + 0.5 * rand()));
      b.angVel.x += (rand() - 0.5) * EXPLODE.spin * 2.2;
      b.angVel.y += (rand() - 0.5) * EXPLODE.spin * 2.2;
      b.angVel.z += (rand() - 0.5) * EXPLODE.spin * 2.2;
      b.wake();
      b.updateDerived();
    }
    this.phase = 'open';
    if (this.onSplit) this.onSplit({ center, normal: null, impactSpeed: -impact.y, mode: 'explode', power: this.power });
  }

  step(h) {
    if (this.phase === 'falling') {
      const w = this.whole;
      w.vel.y -= GRAVITY * h;
      w.pos.addScaledVector(w.vel, h);
      integrateQuat(w.quat, w.angVel, h);
      w.updateDerived();
      const minY = this.world.lowestPoint(w);
      this.lowestY = minY;
      if (minY <= 0) {
        w.pos.y -= minY;
        if (this.mode === 'split') this.split();
        else this.explode();
      }
    } else if (this.phase === 'open') {
      this.world.step(this.bodies, h);
    }
  }

  get asleep() {
    return this.phase === 'open' && this.bodies.every((b) => b.sleeping);
  }
}
