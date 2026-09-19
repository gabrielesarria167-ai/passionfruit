import * as THREE from 'three';
import { createMaterials, createJellyInstances } from './materials.js';
import { FruitModel } from './fruitModel.js';
import { FruitSimulation, GRAVITY, STEP } from './simulation.js';
import { JuiceSystem } from './juice.js';
import { buildShards } from './shards.js';
import { Stage } from './stage.js';
import { mulberry32 } from './noise.js';
import { ARIL_RADII } from './fruitModel.js';

const DEG = Math.PI / 180;
const ORIGIN = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const _offset = new THREE.Matrix4();
const _cling = new THREE.Matrix4();
const _seedScale = new THREE.Matrix4().makeScale(0.9, 0.9, 0.9);
const _glowAt = new THREE.Vector3();

export const DEFAULT_OPTIONS = {
  backdrop: 'night',
  variety: 'purple',
  impact: 'explode',
  slowMotion: true,
  autoReplay: false,
};

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Renders the drop: a whole fruit falls into frame, hits the surface and either
// bursts (rind shards, pulp and juice thrown across the floor) or tears in two
// and the halves roll onto their backs.
// Phases: loading -> waiting -> falling -> open -> rest.
export class PassionfruitScene {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.onPhase = options.onPhase || null;
    this.reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.resetState();
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(this.dpr);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);

    this.materials = createMaterials();
    this.materials.applyVariety(this.options.variety);
    this.stage = new Stage(renderer, this.scene, this.materials);
    this.stage.applyBackdrop(this.options.backdrop, this.materials);

    this.model = new FruitModel({ seed: 11 });
    this.sim = new FruitSimulation(this.model, buildShards(this.model, { detail: 32 }));
    this.sim.onSplit = (e) => this._onSplit(e);
    this._buildFruit();
    this.juice = new JuiceSystem({
      materials: this.materials,
      arilGeometry: this.looseArilGeo,
      seedGeometry: this.looseSeedGeo,
      gravity: GRAVITY,
    });
    this.scene.add(this.juice.group);

    this.phase = 'loading';
    this.realTime = 0;
    this.impactReal = -1;
    this.acc = 0;
    this.dropCount = 0;
    this.burstCentre = new THREE.Vector3(0, 1, 0);
    this.visible = true;
    this.renderFrames = 2;
    this.frameTimes = [];
    this.lastNow = null;

    this._bindEvents();
    this._resize();
    this._prepare();
  }

  // ------------------------------------------------------------------ build

  _buildFruit() {
    const { model, materials: m } = this;
    this.arilGeos = [model.buildArilGeometry(0), model.buildArilGeometry(1)];
    this.seedGeo = model.buildSeedGeometry();
    // Loose pulp is drawn in the hundreds, so it uses coarser shapes.
    this.looseArilGeo = model.buildArilGeometry(0, [14, 10]);
    this.looseSeedGeo = model.buildSeedGeometry([12, 8]);
    this.geometries = [...this.arilGeos, this.seedGeo, this.looseArilGeo, this.looseSeedGeo];
    this.fruitRoot = new THREE.Group();
    this.scene.add(this.fruitRoot);

    const stemGeo = model.buildStem();
    this.geometries.push(stemGeo);
    const stem = new THREE.Mesh(stemGeo, m.stem);
    const placement = model.stemPlacement();
    stem.position.copy(placement.position);
    stem.rotation.copy(placement.rotation);
    stem.castShadow = true;
    stem.receiveShadow = true;
    stem.layers.enable(2);

    const tint = new THREE.Color();
    const pale = new THREE.Color(1, 1, 1);
    const deep = new THREE.Color(1, 0.8, 0.6);

    this.halves = this.sim.halves.map(({ side, body }) => {
      const group = new THREE.Group();
      const content = new THREE.Group();
      content.position.copy(body.com).negate();
      group.add(content);

      const shellGeo = model.buildShell(model.outerR, model.thetaOut, side, model.segV);
      const shell = new THREE.Mesh(shellGeo, m.skin);
      shell.castShadow = true;
      shell.receiveShadow = true;
      shell.layers.enable(2);

      const liningGeo = model.buildShell(model.innerR, model.thetaIn, side, 36, { inward: true, uvX: 1 });
      const lining = new THREE.Mesh(liningGeo, m.pith);
      lining.receiveShadow = true;

      const rimGeo = model.buildRimStrip(side);
      const rim = new THREE.Mesh(rimGeo, m.pith);
      rim.castShadow = true;
      rim.receiveShadow = true;

      const jellyGeo = model.buildJelly(side);
      const jelly = new THREE.Mesh(jellyGeo, m.jelly.filter);
      jelly.renderOrder = 1;
      const jellyShine = new THREE.Mesh(jellyGeo, m.jelly.shine);
      jellyShine.renderOrder = 2;
      jellyShine.receiveShadow = true;
      jellyShine.name = 'jelly';

      shell.name = 'shell';
      lining.name = 'lining';
      rim.name = 'rim';
      jelly.name = 'jelly';
      content.add(shell, lining, rim, jelly, jellyShine);
      this.geometries.push(shellGeo, liningGeo, rimGeo, jellyGeo);

      const pulp = model.placePulp(side);
      const byVariant = [[], []];
      pulp.arils.forEach((a, i) => byVariant[i % 2].push(a));
      byVariant.forEach((list, variant) => {
        const arils = createJellyInstances(this.arilGeos[variant], m.aril, list.length, 3);
        list.forEach((a, i) => {
          arils.setMatrixAt(i, a.matrix);
          arils.setColorAt(i, tint.copy(pale).lerp(deep, a.tint * 0.75));
        });
        arils.commit();
        for (const mesh of arils.meshes) {
          mesh.name = 'arils';
          content.add(mesh);
        }
      });
      const seeds = new THREE.InstancedMesh(this.seedGeo, m.seed, pulp.seeds.length);
      pulp.seeds.forEach((mat, i) => seeds.setMatrixAt(i, mat));
      seeds.name = 'seeds';
      seeds.receiveShadow = true;
      seeds.computeBoundingSphere();
      content.add(seeds);

      if (side > 0) content.add(stem);
      this.fruitRoot.add(group);
      return { side, body, group };
    });

    // The burst: every rind shard with its own copy of the stalk if it has one.
    this.shardViews = this.sim.shards.map(({ shard, body }) => {
      const group = new THREE.Group();
      const content = new THREE.Group();
      content.position.copy(body.com).negate();
      group.add(content);
      const mesh = new THREE.Mesh(shard.geometry, [m.skin, m.pith]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.layers.enable(2);
      mesh.name = 'shard';
      content.add(mesh);
      this.geometries.push(shard.geometry);
      if (shard.hasStem) {
        const s = stem.clone();
        s.layers.enable(2);
        content.add(s);
      }
      group.visible = false;
      this.fruitRoot.add(group);
      return { body, group };
    });

    this._buildCling();
    this.sim.placeWhole(new THREE.Vector3(0, 60, 0), new THREE.Quaternion());
  }

  // Juice sacs left clinging to the inside of each shard.
  _buildCling() {
    const rand = mulberry32(77);
    const m = this.materials;
    const entries = [];
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    this.shardViews.forEach((view, si) => {
      const { shard } = this.sim.shards[si];
      const [start, end] = shard.inner;
      const pos = shard.geometry.attributes.position;
      const nor = shard.geometry.attributes.normal;
      const want = Math.min(30, Math.round(shard.area * 20));
      for (let i = 0; i < want; i++) {
        const v = start + Math.floor(rand() * (end - start));
        p.fromBufferAttribute(pos, v);
        n.fromBufferAttribute(nor, v);
        p.addScaledVector(n, ARIL_RADII.y * (0.45 + 0.3 * rand()));
        q.setFromEuler(new THREE.Euler(rand() * 6.28, rand() * 6.28, rand() * 6.28));
        const k = 0.8 + 0.34 * rand();
        s.set(k, k, k);
        entries.push({ view, matrix: new THREE.Matrix4().compose(p, q, s), tint: rand() });
      }
    });
    this.cling = entries;
    this.clingArils = createJellyInstances(this.looseArilGeo, m.aril, entries.length, 3);
    this.clingSeeds = new THREE.InstancedMesh(this.looseSeedGeo, m.seed, entries.length);
    this.clingSeeds.receiveShadow = true;
    const tint = new THREE.Color();
    entries.forEach((e, i) => this.clingArils.setColorAt(i, tint.setRGB(1, 1, 1).lerp(new THREE.Color(1, 0.8, 0.6), e.tint * 0.7)));
    for (const mesh of [...this.clingArils.meshes, this.clingSeeds]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.fruitRoot.add(mesh);
    }
  }

  async _prepare() {
    this._syncVisuals();
    this._updateCamera();
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch (err) {
      // Programs still compile on first draw.
    }
    if (this.disposed) return;
    this._warmUp();
    this.phase = 'waiting';
    this.waitTime = 0;
    this._emitPhase();
    this.raf = requestAnimationFrame(this._loop);
  }

  // Draw every pass once with the fruit and some juice in view, then redraw
  // the empty stage in the same task, so shadow and depth programs compile
  // now rather than mid-fall. Only the second frame ever reaches the screen.
  _warmUp() {
    this.sim.placeWhole(new THREE.Vector3(0, 1.1, 0), new THREE.Quaternion());
    this._syncVisuals();
    for (const s of this.shardViews) s.group.visible = true;
    this.clingArils.count = Math.min(4, this.cling.length);
    this.clingSeeds.count = this.clingArils.count;
    const m = new THREE.Matrix4().makeTranslation(0.3, 0.2, 0.8);
    for (const set of [this.juice.drops, this.juice.splats, this.juice.pieces]) {
      set.setMatrixAt(0, m);
      set.count = 1;
    }
    this.juice.pieceSeeds.setMatrixAt(0, m);
    this.juice.pieceSeeds.count = 1;
    this._render(true);
    this.juice.reset();
    this.sim.placeWhole(new THREE.Vector3(0, 60, 0), new THREE.Quaternion());
    this._syncVisuals();
    this._render(true);
  }

  // ------------------------------------------------------------------ events

  _bindEvents() {
    this._onResize = () => {
      this.resizePending = true;
      this.renderFrames = Math.max(this.renderFrames, 2);
    };
    this.resizeObserver = new ResizeObserver(this._onResize);
    this.resizeObserver.observe(this.canvas);

    this.intersection = new IntersectionObserver((entries) => {
      for (const e of entries) this.visible = e.isIntersecting;
      if (this.visible) this.renderFrames = Math.max(this.renderFrames, 2);
    });
    this.intersection.observe(this.canvas);

    this._onVisibility = () => {
      this.lastNow = null;
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  _resize() {
    this.resizePending = false;
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    this.camera.fov = this.aspect < 0.9 ? 36 : 30;
    this.camera.updateProjectionMatrix();
  }

  _emitPhase() {
    if (this.onPhase) this.onPhase(this.phase);
  }

  // ------------------------------------------------------------------ public

  setOptions(next = {}) {
    const prev = this.options;
    this.options = { ...prev, ...next };
    if (next.variety && next.variety !== prev.variety) this.materials.applyVariety(this.options.variety);
    if (next.backdrop && next.backdrop !== prev.backdrop) this.stage.applyBackdrop(this.options.backdrop, this.materials);
    if (this.phase === 'rest' && this.options.autoReplay && !prev.autoReplay) this.restTime = 0;
    this.renderFrames = Math.max(this.renderFrames, 2);
  }

  replay() {
    if (this.phase === 'loading') return;
    this._startDrop(true);
  }

  // Deterministically advance the timeline without the animation loop and draw
  // one frame. Used for stills and tests.
  async seek(seconds, dt = 1 / 60) {
    while (this.phase === 'loading' && !this.disposed) await new Promise((r) => setTimeout(r, 20));
    cancelAnimationFrame(this.raf);
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
      this.realTime += dt;
      this._update(dt);
    }
    this._resize();
    this._render(true);
    this._render(true);
  }

  // ------------------------------------------------------------------ sequence

  _startDrop(vary = false) {
    const rand = vary ? Math.random : mulberry32(3);
    this.dropCount++;
    this.juice.reset();
    this.acc = 0;
    this.impactReal = -1;
    this.restTime = 0;

    const portrait = this.aspect < 0.9;
    const qImpact = this.sim.impactOrientation({
      azimuth: (portrait ? 58 : 14) * DEG + (vary ? (rand() - 0.5) * 0.5 : 0),
      tilt: -0.05 + (vary ? (rand() - 0.5) * 0.08 : 0),
      roll: vary ? rand() : 0.3,
    });
    const spin = new THREE.Vector3(0.45, 1.1, -1.25);
    if (vary) spin.add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.8));
    this.sim.prepareDrop({
      qImpact,
      spin,
      startHeight: this._startHeight(),
      mode: this.options.impact === 'split' ? 'split' : 'explode',
      rand,
      power: portrait ? 0.72 : 1, // a narrow frame cannot hold a wide scatter
    });

    this.phase = 'falling';
    this._emitPhase();
    this.renderFrames = Math.max(this.renderFrames, 2);
    if (this.reducedMotion) this._skipToEnd();
  }

  // Height at which the whole fruit sits just above the top edge of the frame.
  _startHeight() {
    this._updateCamera();
    const v = new THREE.Vector3();
    let lo = 1;
    let hi = 40;
    for (let i = 0; i < 30; i++) {
      const mid = 0.5 * (lo + hi);
      v.set(0, mid - 1.35, 0).project(this.camera);
      if (v.y > 1.02) hi = mid;
      else lo = mid;
    }
    return hi + 0.2;
  }

  _onSplit({ center, normal, mode, power }) {
    const rand = mulberry32(1000 + this.dropCount);
    if (mode === 'explode') this.juice.explode({ center, rand, power });
    else this.juice.burst({ center, normal, rand });
    this.burstCentre = center.clone();
    this.phase = 'open';
    this.impactReal = this.realTime;
    this._emitPhase();
  }

  _skipToEnd() {
    let guard = 0;
    while (this.sim.phase === 'falling' && guard++ < 40000) this._stepSim(STEP);
    for (let i = 0; i < 480 * 8; i++) this._stepSim(STEP);
    this.impactReal = this.realTime - 100;
    this._syncVisuals();
  }

  // Real time runs slowest right at the impact, so the burst itself can be
  // watched, then eases back to full speed while the pieces come down.
  _timeScale() {
    if (!this.options.slowMotion || this.reducedMotion) return 1;
    if (this.phase === 'falling') return 0.24 + 0.76 * smoothstep(0.02, 0.95, this.sim.lowestY);
    if (this.phase === 'open' || this.phase === 'rest') {
      const t = this.realTime - this.impactReal;
      const burst = this.sim.mode !== 'split';
      const hold = burst ? 1.3 : 0.55;
      const back = burst ? 3.6 : 1.75;
      const slow = burst ? 0.1 : 0.24;
      if (t < hold) return slow;
      if (t < back) return slow + (1 - slow) * smoothstep(hold, back, t);
    }
    return 1;
  }

  // Two lights tell the story: a spot that follows the fruit down out of the
  // dark, and the fruit's own light, which takes over when it bursts.
  _updateGlow() {
    const light = this.stage.glow;
    const scale = this.stage.glowScale;
    const open = this.sim.phase === 'open';
    const fruit = this.sim.whole.fruitToWorld(ORIGIN, _glowAt.clone());
    const since = this.realTime - this.impactReal;

    const b = this.stage.backdrop;
    if (b.keyFall !== undefined) {
      const key = this.stage.key;
      if (!open) {
        key.target.position.set(fruit.x, Math.max(0.2, fruit.y), fruit.z);
        key.intensity = b.keyFall;
      } else {
        // Ease off the fruit and onto the floor once it is no longer one thing.
        const k = 1 - Math.exp(-since * 1.6);
        key.target.position.lerp(this.burstCentre, k).lerp(ORIGIN, k * 0.5);
        key.intensity = b.key + (b.keyFall - b.key) * Math.exp(-since * 1.3);
      }
      key.target.updateMatrixWorld();
    }

    if (scale <= 0.001) {
      light.intensity = 0;
      return;
    }
    if (!open) {
      light.position.set(fruit.x, Math.max(0.12, fruit.y - 0.72), fruit.z);
      light.intensity = 9 * scale;
      return;
    }
    // Follow the pulp: the centre of everything still in the air.
    const p = _glowAt.set(0, 0, 0);
    let n = 0;
    for (const piece of this.juice.pieceState) {
      if (!piece.alive || piece.landed) continue;
      p.add(piece.p);
      n++;
    }
    if (n) p.divideScalar(n);
    else p.copy(this.burstCentre);
    light.position.set(p.x, Math.max(0.22, p.y), p.z);
    light.intensity = (26 + 95 * Math.exp(-since * 1.1)) * scale;
  }

  _stepSim(h) {
    this.sim.step(h);
    if (this.sim.phase === 'open') this.juice.update(h);
  }

  _syncVisuals() {
    const open = this.sim.phase === 'open';
    const burst = open && this.sim.mode === 'explode';
    const w = this.sim.whole;
    for (const s of this.shardViews) {
      s.group.visible = burst;
      if (burst) {
        s.group.position.copy(s.body.pos);
        s.group.quaternion.copy(s.body.quat);
        s.matrix = (s.matrix || new THREE.Matrix4())
          .compose(s.body.pos, s.body.quat, ONE)
          .multiply(_offset.makeTranslation(-s.body.com.x, -s.body.com.y, -s.body.com.z));
      }
    }
    if (burst) {
      this.cling.forEach((e, i) => {
        this.clingArils.setMatrixAt(i, _cling.multiplyMatrices(e.view.matrix, e.matrix));
        this.clingSeeds.setMatrixAt(i, _cling.multiply(_seedScale));
      });
      this.clingArils.count = this.cling.length;
      this.clingSeeds.count = this.cling.length;
      this.clingArils.filter.instanceMatrix.needsUpdate = true;
      this.clingSeeds.instanceMatrix.needsUpdate = true;
    } else {
      this.clingArils.count = 0;
      this.clingSeeds.count = 0;
    }
    for (const h of this.halves) {
      h.group.visible = !burst;
      if (open) {
        h.group.position.copy(h.body.pos);
        h.group.quaternion.copy(h.body.quat);
      } else {
        w.fruitToWorld(h.body.com, h.group.position);
        h.group.quaternion.copy(w.quat);
      }
    }
  }

  // One locked shot for the whole drop: wide enough to hold the fall and
  // everything the burst throws across the floor, and it never moves.
  _updateCamera() {
    const aspect = this.aspect || 1.6;
    const portrait = aspect < 0.9;
    const tanV = Math.tan((this.camera.fov * DEG) / 2);
    const burst = this.sim.mode !== 'split';
    // How far across the floor the pieces can travel.
    const reach = burst ? (portrait ? 3.2 : 5.6) : portrait ? 2.6 : 3.6;
    const elev = 5 * DEG; // almost level with the floor
    // Seen this flat the scatter is a shallow band, but the burst throws a
    // plume several units up: the frame has to hold that too.
    const flat = reach * Math.sin(elev) + (portrait ? 1.0 : 0.85);
    const needV = burst ? Math.max(flat, portrait ? 2.4 : 3.6) : flat;
    const dist = Math.max(needV / tanV, reach / (tanV * aspect));
    const target = new THREE.Vector3(0, burst ? (portrait ? 0.8 : 1.05) : 0.12, 0);
    this.camera.position.set(target.x, target.y + dist * Math.sin(elev), target.z + dist * Math.cos(elev));
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ loop

  _loop = (now) => {
    this.raf = requestAnimationFrame(this._loop);
    const realDt = this.lastNow === null ? 1 / 60 : Math.min(0.05, (now - this.lastNow) / 1000);
    this.lastNow = now;
    if (!this.visible || document.hidden) return;
    if (this.resizePending) this._resize();

    this.realTime += realDt;
    const moving = this._update(realDt);
    if (moving || this.renderFrames > 0) {
      this._render(moving);
      this.renderFrames = Math.max(0, this.renderFrames - 1);
      this._measure(realDt, moving);
    }
  };

  _update(realDt) {
    if (this.phase === 'waiting') {
      this.waitTime += realDt;
      if (this.waitTime > 0.45) this._startDrop(false);
    }

    const dt = realDt * this._timeScale();
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 240) {
      this._stepSim(STEP);
      this.acc -= STEP;
      steps++;
    }
    this._syncVisuals();
    this._updateGlow();

    this._updateCamera();

    if (this.phase === 'open') {
      if (this.sim.asleep && this.juice.settled) {
        this.phase = 'rest';
        this.restTime = 0;
        this._emitPhase();
      }
    } else if (this.phase === 'rest') {
      this.restTime += realDt;
      if (this.options.autoReplay && this.restTime > 3.5) this._startDrop(true);
    }
    return this.phase === 'falling' || this.phase === 'open';
  }

  _render(moving) {
    if (moving || this.renderFrames > 0) this.stage.contact.render(this.scene);
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }

  // Drop resolution on slower GPUs rather than dropping frames. Frames that
  // stall (shader compiles, tab switches) are ignored.
  _measure(realDt, moving) {
    if (!moving || realDt > 0.1 || this.realTime < 1.5) return;
    this.frameTimes.push(realDt);
    if (this.frameTimes.length < 30) return;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.frameTimes.length = 0;
    if (median > 1 / 45 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.resizePending = true;
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.intersection.disconnect();
    document.removeEventListener('visibilitychange', this._onVisibility);
    for (const g of this.geometries) g.dispose();
    this.fruitRoot.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
    this.juice.dispose();
    this.stage.dispose();
    this.materials.dispose();
    this.renderer.dispose();
  }
}

export function mount(canvas, options) {
  const existing = canvas.__passionfruit;
  if (existing && !existing.disposed) {
    existing.setOptions(options || {});
    return existing;
  }
  const scene = new PassionfruitScene(canvas, options);
  canvas.__passionfruit = scene;
  return scene;
}
