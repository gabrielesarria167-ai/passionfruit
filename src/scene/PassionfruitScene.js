import * as THREE from 'three';
import { createMaterials, createJellyInstances } from './materials.js';
import { FruitModel } from './fruitModel.js';
import { FruitSimulation, GRAVITY, STEP } from './simulation.js';
import { JuiceSystem } from './juice.js';
import { buildShards } from './shards.js';
import { Stage, FRUIT_LAYER } from './stage.js';
import { TextPlane } from './textPlane.js';
import { StarField } from './stars.js';
import { Comets } from './comets.js';
import { Veil } from './veil.js';
import { mulberry32 } from './noise.js';
import { ARIL_RADII } from './fruitModel.js';

const DEG = Math.PI / 180;
const LINE_WIDTH = 5.6;
const OPENER_WIDTH = 2.9;
// Seconds after the impact: the camera's move in, then the line arriving.
// The move starts the instant the fruit lands and settles quickly.
const FOCUS_IN = 0;
const FOCUS_SET = 1.70;
const LINE_LIT = FOCUS_SET + 0.5;
// The crossing opens as the hold on the line ends. From then on each piece
// turns on its own, as it touches the floor: a drop of juice or
// pulp lights up and falls into a real star, and so does most of the rind;
// the rest catches light and comes back as a comet shooting down and to the
// right. Whatever is still in the air keeps flying until its turn. The camera
// sinks and tips its gaze down onto the scatter, so the words rise away out of
// the frame, and night comes up from below as the pieces go, taking the floor.
// The burst is held almost still while the camera settles on the line, then
// time comes back to full speed quickly so the pieces come down.
const SLOW_HOLD = 2.4;
const SLOW_BACK = 2.9;
// A piece turns when it touches the floor: the frame it would reach it, in
// seconds as seen, so it is never caught short in the air nor sunk through.
const LEAD = 1 / 60;
// How long a piece takes to shrink away on the floor once it has turned.
const TURN_FADE = 0.15;
// What _crossTime() reads before the crossing opens.
const PENDING = -1e9;
const CROSS_MOVE = 2.8;
const SINK = 1.1;
const DOLLY = 0.6;
const TILT = 22 * DEG;
// How long a drop takes to fall into its star.
const SETTLE = 1.5;
// The stars ride with the camera but for a slow drift up the frame, so the
// drops that become them stay in the shot.
const SKY_DRIFT = 4 * DEG;
const SKY_HOLD = 9;
const SKY_COLOR = '#030409';
// Without the camera move the crossing is a dissolve through the night.
const STILL_FADE = 0.8;
const COMET_TAILS = { purple: '#b95c9c', golden: '#e0a043' };
// A comet's heading on screen, measured from straight down towards the right.
const COMET_SLANT = 38 * DEG;
const COMET_SPREAD = 14 * DEG;
// The share of the rind that becomes comets; the rest turns into stars.
const COMET_SHARE = 0.25;
// Seconds after its piece is reached that a comet appears, spread out.
const COMET_DELAY = [0.3, 2.6];
const ORIGIN = new THREE.Vector3();
const _offset = new THREE.Matrix4();
const _cling = new THREE.Matrix4();
const _seedScale = new THREE.Matrix4().makeScale(0.9, 0.9, 0.9);
const _keep = new THREE.Vector3();
const _glowAt = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _dir = new THREE.Vector3();
const _now = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _fall = new THREE.Vector3();
const _at = [0, 0];
const _sky = new THREE.Color(SKY_COLOR);
const _rgbA = { r: 0, g: 0, b: 0 };
const _rgbB = { r: 0, g: 0, b: 0 };
const X_AXIS = new THREE.Vector3(1, 0, 0);

export const DEFAULT_OPTIONS = {
  backdrop: 'night',
  variety: 'purple',
  impact: 'explode',
  slowMotion: true,
  autoReplay: false,
  // 'stars' carries the burst into the night sky; 'none' ends on the line.
  transition: 'stars',
  line: 'But passion drives us forward',
  opener: 'We don\u2019t have to do it',
};

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
// The move: gentle off the mark, a long glide to rest.
const lift = (u) => smoothstep(0, 1, Math.pow(Math.min(1, Math.max(0, u)), 0.8));
// Simulated seconds until something `h` above the floor, rising at `vy`,
// comes down onto it.
const untilFloor = (h, vy) => (h <= 0 ? 0 : (vy + Math.sqrt(vy * vy + 2 * GRAVITY * h)) / GRAVITY);

// Renders the drop: a whole fruit falls into frame, hits the surface and either
// bursts (rind shards, pulp and juice thrown across the floor) or tears in two
// and the halves roll onto their backs.
// Phases: loading -> waiting -> falling -> open -> rest, or with the
// transition, open -> sky.
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
    this.sim = new FruitSimulation(this.model, buildShards(this.model, { detail: 52 }));
    this.sim.onSplit = (e) => this._onSplit(e);
    this._buildFruit();
    this.juice = new JuiceSystem({
      materials: this.materials,
      arilGeometry: this.looseArilGeo,
      seedGeometry: this.looseSeedGeo,
      gravity: GRAVITY,
    });
    this.scene.add(this.juice.group);

    // The floor goes down between the stars, which it hides, and the glowing
    // pieces turning into them, which hang in front of it.
    this.stage.ground.renderOrder = -9;
    this.sky = new StarField();
    this.comets = new Comets();
    this.sky.points.add(this.comets.tails, this.comets.heads);
    this.scene.add(this.sky.points);
    this.veil = new Veil(SKY_COLOR);
    this.scene.add(this.veil.mesh);
    this.cut = false;
    this.crossing = null;

    this.phase = 'loading';
    this.realTime = 0;
    this.impactReal = null;
    this.crossAt = null;
    this.acc = 0;
    this.dropCount = 0;
    this.burstCentre = new THREE.Vector3(0, 1, 0);
    this.visible = true;
    this.observerWorks = false;
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
    stem.layers.enable(FRUIT_LAYER);

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
      shell.layers.enable(FRUIT_LAYER);

      const liningGeo = model.buildShell(model.innerR, model.thetaIn, side, 36, { inward: true, uvX: 1 });
      const lining = new THREE.Mesh(liningGeo, m.pith);
      lining.layers.enable(FRUIT_LAYER);

      const rimGeo = model.buildRimStrip(side);
      const rim = new THREE.Mesh(rimGeo, m.pith);
      rim.layers.enable(FRUIT_LAYER);

      const jellyGeo = model.buildJelly(side);
      const jelly = new THREE.Mesh(jellyGeo, m.jelly.filter);
      jelly.renderOrder = 1;
      const jellyShine = new THREE.Mesh(jellyGeo, m.jelly.shine);
      jellyShine.renderOrder = 2;
      jellyShine.layers.enable(FRUIT_LAYER);
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
          mesh.layers.enable(FRUIT_LAYER);
          content.add(mesh);
        }
      });
      const seeds = new THREE.InstancedMesh(this.seedGeo, m.seed, pulp.seeds.length);
      pulp.seeds.forEach((mat, i) => seeds.setMatrixAt(i, mat));
      seeds.name = 'seeds';
      seeds.layers.enable(FRUIT_LAYER);
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
      mesh.layers.enable(FRUIT_LAYER);
      mesh.name = 'shard';
      content.add(mesh);
      this.geometries.push(shard.geometry);
      if (shard.hasStem) {
        const s = stem.clone();
        s.layers.enable(FRUIT_LAYER);
        content.add(s);
      }
      group.visible = false;
      this.fruitRoot.add(group);
      return { body, group, area: shard.area, keep: 1 };
    });

    this._buildCling();

    // Both lines stand in the scene rather than on top of it. The first waits
    // low, under the fall, and the camera simply leaves it behind; the second
    // is high and behind the plume, so the pieces cross in front of the words.
    this.opener = new TextPlane({ text: this.options.opener, width: OPENER_WIDTH });
    this.opener.mesh.position.set(0, 0.16, 4.2);
    this.opener.opacity = 0.9;
    this.scene.add(this.opener.mesh);

    this.line = new TextPlane({ text: this.options.line, width: LINE_WIDTH });
    this.line.mesh.position.set(0, 2.9, -1);
    this.scene.add(this.line.mesh);

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
    this.clingSeeds.layers.enable(FRUIT_LAYER);
    const tint = new THREE.Color();
    entries.forEach((e, i) => this.clingArils.setColorAt(i, tint.setRGB(1, 1, 1).lerp(new THREE.Color(1, 0.8, 0.6), e.tint * 0.7)));
    for (const mesh of this.clingArils.meshes) mesh.layers.enable(FRUIT_LAYER);
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
    this.sky.points.visible = true;
    this.veil.mesh.visible = true;
    this._render(true);
    this.sky.points.visible = false;
    this.veil.mesh.visible = false;
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

    // Some hosts draw the page in a way the observer cannot measure and report
    // the canvas as permanently offscreen. Only an observer that has seen it on
    // screen at least once is allowed to pause the loop.
    this.intersection = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) this.observerWorks = true;
        this.visible = e.isIntersecting || !this.observerWorks;
      }
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
    this.viewW = w;
    this.viewH = h;
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    this.camera.fov = this.aspect < 0.9 ? 36 : 30;
    this.camera.updateProjectionMatrix();
    // A narrow frame holds Orion alone; a wide one takes in Sirius as well.
    this.sky.aim(this.aspect < 0.9 ? 0 : 0.22);
  }

  _emitPhase() {
    if (this.onPhase) this.onPhase(this.phase);
  }

  // ------------------------------------------------------------------ public

  setOptions(next = {}) {
    const prev = this.options;
    this.options = { ...prev, ...next };
    if (next.variety && next.variety !== prev.variety) this.materials.applyVariety(this.options.variety);
    if (next.backdrop && next.backdrop !== prev.backdrop) {
      this.stage.applyBackdrop(this.options.backdrop, this.materials);
      if (this.cut) this._nightfall(1);
    }
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
    this.impactReal = null;
    this.crossAt = null;
    this.restTime = 0;
    this._leaveSky();

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
      // A narrow frame cannot hold a wide scatter.
      power: this.aspect < 0.62 ? 0.55 : portrait ? 0.72 : 1,
    });
    for (const b of this.sim.bodies) b.touched = false;

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
    // Without the camera move the crossing is a slow dissolve a few seconds
    // after the still of the aftermath comes up.
    this.crossBase = this.realTime + 3;
    this._syncVisuals();
  }

  // Real time runs slowest right at the impact, so the burst itself can be
  // watched, then eases back to full speed while the pieces come down.
  _timeScale() {
    if (this.reducedMotion) return 1;
    return this._slowMotion();
  }

  _slowMotion() {
    if (!this.options.slowMotion) return 1;
    if (this.phase === 'falling') return 0.24 + 0.76 * smoothstep(0.02, 0.95, this.sim.lowestY);
    if (this.phase === 'open' || this.phase === 'rest') {
      const t = this.realTime - this.impactReal;
      const burst = this.sim.mode !== 'split';
      const hold = burst ? SLOW_HOLD : 0.55;
      const back = burst ? SLOW_BACK : 1.75;
      const slow = burst ? 0.075 : 0.24;
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

    // The set goes dark as its light goes up into the sky.
    const b = this.stage.backdrop;
    // What is still flying stays lit until nearly everything has turned.
    const dim = this.reducedMotion ? 1 : 1 - smoothstep(0.7, 1, this._nightfallen());
    this.stage.rim.intensity = b.rim * dim;
    this.stage.hemi.intensity = b.hemi * dim;
    this.scene.environmentIntensity = b.env * dim;
    if (b.keyFall !== undefined) {
      const key = this.stage.key;
      if (!open) {
        key.target.position.set(fruit.x, Math.max(0.2, fruit.y), fruit.z);
        key.intensity = b.keyFall;
      } else {
        // Ease off the fruit and onto the floor once it is no longer one thing.
        const k = 1 - Math.exp(-since * 1.6);
        key.target.position.lerp(this.burstCentre, k).lerp(ORIGIN, k * 0.5);
        key.intensity = (b.key + (b.keyFall - b.key) * Math.exp(-since * 1.3)) * dim;
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
    light.intensity = (26 + 95 * Math.exp(-since * 1.1)) * scale * dim;
  }

  // 0 before the burst, 1 once the camera has settled on the line.
  _focus() {
    if (this.impactReal === null || this.sim.mode === 'split') return 0;
    return smoothstep(FOCUS_IN, FOCUS_SET, this.realTime - this.impactReal);
  }

  _stepSim(h) {
    this.sim.step(h);
    if (this.sim.phase !== 'open') return;
    this.juice.update(h);
    for (const b of this.sim.bodies) if (b.inContact) b.touched = true;
  }

  // Open the crossing once the line is up and the hold on it is over.
  _openCrossing() {
    if (this.crossAt !== null || this.reducedMotion || this._crossTime() !== PENDING) return;
    const hold = this.options.slowMotion ? SLOW_HOLD : 0;
    if (this.realTime - this.impactReal >= Math.max(LINE_LIT, hold)) this.crossAt = this.realTime;
  }

  // How far night has come, 0-1: it follows the share of the pieces that
  // have turned.
  _nightfallen() {
    return this.crossing ? this.crossing.shown : 0;
  }

  _syncVisuals() {
    const open = this.sim.phase === 'open';
    const burst = open && this.sim.mode === 'explode';
    const w = this.sim.whole;
    for (const s of this.shardViews) {
      s.group.visible = burst && s.keep > 0.001;
      if (burst) {
        s.group.position.copy(s.body.pos);
        s.group.quaternion.copy(s.body.quat);
        s.group.scale.setScalar(s.keep);
        s.matrix = (s.matrix || new THREE.Matrix4())
          .compose(s.body.pos, s.body.quat, _keep.setScalar(s.keep))
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
    if (open) this.juice.sync();
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
    // A very narrow or short frame would otherwise push the camera far enough
    // back to lose the fruit altogether: hold it in and crop the scatter.
    const wide = Math.min(Math.max(needV / tanV, reach / (tanV * aspect)), burst ? 16 : 14);
    // The camera always closes in by a good margin — enough to leave the first
    // line behind — and the second line is sized to fill that final shot.
    const halfW = (d) => tanV * aspect * d;
    const close = Math.min(wide * 0.72, Math.max(LINE_WIDTH / (1.72 * tanV * aspect), 1.9 / tanV));
    const lineWidth = Math.min(LINE_WIDTH, 1.72 * halfW(close));
    this.line.mesh.scale.setScalar(lineWidth / LINE_WIDTH);
    this.opener.mesh.scale.setScalar(Math.min(1, (1.5 * halfW(wide)) / OPENER_WIDTH));
    const f = this._focus();
    const dist = THREE.MathUtils.lerp(wide, close, f);
    const target = new THREE.Vector3(
      0,
      THREE.MathUtils.lerp(burst ? (portrait ? 0.8 : 1.05) : 0.12, 2.1, f),
      THREE.MathUtils.lerp(0, -0.7, f),
    );
    this.camera.position.set(target.x, target.y + dist * Math.sin(elev), target.z + dist * Math.cos(elev));
    this.camera.lookAt(target);
    this._crossCamera(this._crossTime());
    this.camera.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ crossing

  // Seconds into the crossing (negative before it starts), or -Infinity when
  // this drop has none.
  _crossTime() {
    if (this.options.transition !== 'stars' || this.sim.mode === 'split' || this.impactReal === null) return -Infinity;
    if (this.reducedMotion) return this.realTime - this.crossBase;
    return this.crossAt === null ? PENDING : this.realTime - this.crossAt;
  }

  // Down: the camera sinks off the line and tips its gaze onto the floor, so
  // the words rise away out of the top of the frame.
  _crossCamera(k) {
    if (k <= 0 || this.reducedMotion) return;
    const cam = this.camera;
    const e = lift(k / CROSS_MOVE);
    cam.position.y -= SINK * e;
    cam.position.z -= DOLLY * e;
    cam.quaternion.multiply(_qa.setFromAxisAngle(X_AXIS, -TILT * e));
  }

  // Everything that can still turn into sky, gathered as the crossing opens:
  // the drops and pulp, and the rind, a few pieces of it as comets and the
  // rest as stars. Each knows how long it has before it touches the floor.
  _beginCrossing() {
    const rand = mulberry32(500 + this.dropCount);
    this.sky.gather(this.camera.fov, this.aspect);
    this.comets.reset();
    this.comets.tint = COMET_TAILS[this.options.variety] || COMET_TAILS.purple;
    const world = this.sim.world;
    const drops = [];
    const add = (src, land, radius, mags, pulp = false) => {
      drops.push({ src, land, radius, mags, pulp, fall: rand(), sway: rand() - 0.5, t0: null, star: -1, spare: false, r0: 0, done: false });
    };
    const rind = (body) => () => (body.touched || body.sleeping ? 0 : untilFloor(world.lowestPoint(body), body.vel.y));
    // The pulp has its pick of the stars; the bigger drops of juice take faint
    // ones, and the finest mist only sparks and dies.
    const arilR = (ARIL_RADII.x + ARIL_RADII.y + ARIL_RADII.z) / 3;
    for (const src of this.juice.pieceState) {
      if (!src.alive) continue;
      add(src, () => (src.splatted ? 0 : untilFloor(src.p.y - 0.1 * src.s, src.v.y)), arilR * src.s, [-2, 5.5], true);
    }
    for (const src of this.juice.dropState) {
      if (!src.alive) continue;
      add(src, () => (src.alive ? untilFloor(src.p.y - src.r * 0.6, src.v.y) : 0), src.r, src.r > 0.018 ? [4, 6.5] : null);
    }
    const shards = [];
    for (const view of this.shardViews) {
      const land = rind(view.body);
      if (rand() < COMET_SHARE) {
        shards.push({ view, land, t0: null, rand: Array.from({ length: 7 }, rand) });
        continue;
      }
      // A piece of rind turned star is handed over like a drop, and takes one
      // of the brightest.
      const src = {
        p: view.body.pos,
        set keep(v) {
          view.keep = v;
        },
      };
      add(src, land, 0.35 * Math.sqrt(view.area), [-2, 3.5], true);
    }
    const total = drops.length + shards.length;
    this.crossing = { drops, shards, total, turned: 0, shown: 0, lastTurn: this.realTime, lastReal: this.realTime };
  }

  // Each piece turns as it touches the floor: a drop lights up
  // and falls into a free star below it, and so does most of the rind; a
  // comet shoots off. Night comes up from the bottom of the frame as they go,
  // taking the floor and the puddles on it.
  _handOff(front) {
    const { crossing, camera: cam, sky } = this;
    const dt = this.realTime - crossing.lastReal;
    crossing.lastReal = this.realTime;
    const pxPerUnit = this.viewH / 2 / Math.tan((cam.fov * DEG) / 2);
    const open = !this.cut;
    // LEAD in simulated seconds, at the pace time is running now.
    const lead = LEAD * this._timeScale();

    // Where it is in the sky now, and how far from the camera.
    const where = (p) => {
      _dir.copy(p).sub(cam.position);
      const dist = _dir.length();
      sky.toSky(_dir.divideScalar(dist), _now);
      return dist;
    };
    const turn = () => {
      crossing.turned++;
      crossing.lastTurn = this.realTime;
    };

    for (const d of crossing.drops) {
      if (d.done) continue;
      if (d.t0 === null) {
        if (!open || d.land() > lead) continue;
        const dist = where(d.src.p);
        turn();
        d.src.turned = true;
        d.t0 = this.realTime;
        d.r0 = Math.min(40, Math.max(1.2, (d.radius / dist) * pxPerUnit));
        // Sparks fall: each makes for a free star somewhere below it.
        sky.frameOf(_now, _at);
        const down = (_at[1] + 1.05) * (0.1 + 0.9 * d.fall);
        sky.dirOf(_at[0] * 0.9 + 0.3 * d.sway, Math.max(-1, _at[1] - down), _dir);
        d.star = d.mags ? sky.claim(_dir, d.mags[0], d.mags[1], 8 * DEG) : -1;
        if (d.star < 0 && d.pulp) d.star = sky.claim(_dir, -2, 6.5, 30 * DEG);
        // With none left it stays a spark, and dies.
        d.spare = d.star < 0;
        if (d.spare) d.star = sky.spare();
      } else {
        where(d.src.p);
      }
      const tau = this.realTime - d.t0;
      d.src.keep = 1 - smoothstep(0, TURN_FADE, tau);
      d.done = tau >= SETTLE;
      if (d.star < 0) continue;
      if (d.spare) {
        const fade = smoothstep(0, 0.9, tau);
        sky.frameOf(_now, _at);
        sky.dirOf(_at[0], _at[1] - 0.12 * (0.5 + d.fall) * fade, _dir);
        sky.hold(d.star, _dir, 0, d.r0 * (1 - 0.6 * fade), 1 - fade);
      } else {
        const m = smoothstep(0, SETTLE, tau);
        sky.hold(d.star, _now, m, d.r0 * Math.pow(1 - m, 1.2), 1 - m);
      }
    }
    sky.commit();

    // The puddles drain away into the night.
    for (const sp of this.juice.splatState) {
      if (sp.gone === undefined) {
        if (!open) continue;
        _ndc.set(sp.x, 0, sp.z).project(cam);
        if (_ndc.z < 1 && _ndc.y < front + 0.1) sp.gone = this.realTime;
        else continue;
      }
      sp.keep = Math.min(sp.keep, 1 - smoothstep(0, 0.4, this.realTime - sp.gone));
    }

    // Night follows the share of the pieces that have turned, eased.
    const share = crossing.total ? crossing.turned / crossing.total : 1;
    crossing.shown += (share - crossing.shown) * (1 - Math.exp(-5 * dt));
    if (share >= 1 && crossing.shown > 0.995) crossing.shown = 1;

    for (const sh of crossing.shards) {
      if (sh.t0 !== null) {
        sh.view.keep = 1 - smoothstep(0, TURN_FADE, this.realTime - sh.t0);
        continue;
      }
      if (!open || sh.land() > lead) continue;
      turn();
      sh.t0 = this.realTime;
      const size = Math.sqrt(sh.view.area);
      const [r0, r1, r2, r3, r4, r5, r6] = sh.rand;
      // The piece goes out, and a moment later its comet streaks across the
      // new sky: from high on the left, down and to the right like a shooting
      // star, the same way for all of them give or take a little.
      const slant = COMET_SLANT + COMET_SPREAD * (r3 - 0.5);
      sky.toSky(_fall.set(Math.sin(slant), -Math.cos(slant), 0).applyQuaternion(cam.quaternion), _fall);
      sky.dirOf(-1.15 + 1.2 * r5, 0.25 + 0.8 * r6, _dir);
      const cruise = 0.36 + 0.18 * r0;
      this.comets.launch({
        time: this.realTime + COMET_DELAY[0] + (COMET_DELAY[1] - COMET_DELAY[0]) * r4,
        dir: _dir,
        speed: 1.6 * cruise,
        heading: _fall,
        cruise,
        glow: 0,
        bright: 0.8 + 0.9 * size,
        size: 1.8 + 2.4 * size,
        tail: (12 + 8 * r1) * DEG,
        life: 2.6 + 1.2 * r2,
      });
    }
  }

  // The set's own colour gives way to the night's, mixed as the eye sees it
  // so that a pale set darkens evenly.
  _nightfall(t) {
    const bg = this.stage.background;
    const a = bg.set(this.stage.backdrop.bg).getRGB(_rgbA, THREE.SRGBColorSpace);
    const b = _sky.getRGB(_rgbB, THREE.SRGBColorSpace);
    bg.setRGB(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, THREE.SRGBColorSpace);
    this.scene.fog.color.copy(bg);
  }

  // Nothing of the set is left in the frame: put it away for good.
  _enterSky() {
    this.cut = true;
    this.fruitRoot.visible = false;
    this.juice.group.visible = false;
    this.stage.ground.visible = false;
    this.opener.mesh.visible = false;
    this._nightfall(1);
    this.phase = 'sky';
    this.restTime = 0;
    this._emitPhase();
  }

  _leaveSky() {
    this.cut = false;
    this.crossing = null;
    this.fruitRoot.visible = true;
    this.juice.group.visible = true;
    this.stage.ground.visible = true;
    this.opener.mesh.visible = true;
    if (this.stage.backdrop) this.stage.applyBackdrop(this.options.backdrop, this.materials);
    this.materials.ground.setNight(-2, 1);
    for (const s of this.shardViews) s.keep = 1;
    this.comets.reset();
    this.sky.points.visible = false;
    this.veil.amount = 0;
  }

  _updateSky() {
    const k = this._crossTime();
    const sky = this.sky;
    sky.points.visible = k >= 0;
    if (!(k >= 0)) return;
    if (!this.crossing) this._beginCrossing();
    const u = sky.uniforms;
    u.uTime.value = this.realTime;
    u.uPixelRatio.value = this.dpr;
    sky.points.position.copy(this.camera.position);

    if (this.reducedMotion) {
      // A dissolve through the night, and a sky that holds still.
      sky.frame(this.camera.quaternion);
      u.uNight.value = 3;
      u.uReveal.value = 1;
      u.uTwinkle.value = 0;
      if (!this.cut && k >= STILL_FADE) this._enterSky();
      this.veil.amount = 1 - smoothstep(0, STILL_FADE, Math.abs(k - STILL_FADE));
      sky.points.visible = this.cut;
      return;
    }

    const e = lift(k / CROSS_MOVE);
    sky.frame(_qb.copy(this.camera.quaternion).multiply(_qa.setFromAxisAngle(X_AXIS, -SKY_DRIFT * (1 - e))));
    sky.points.updateMatrixWorld();
    const crossing = this.crossing;
    const front = crossing.shown >= 1 ? 3 : -1.15 + 2.3 * crossing.shown;
    u.uNight.value = front;
    this.materials.ground.setNight(front, this.viewH * this.dpr);
    this._handOff(front);
    this.comets.update(this.realTime, this.dpr, this.viewW, this.viewH);
    u.uReveal.value = crossing.shown;
    u.uTwinkle.value = 0.12;
    if (!this.cut) this._nightfall(smoothstep(0, 1, crossing.shown));
    // The set goes for good once the camera has arrived and the last piece has
    // turned and gone; a piece that never comes down cannot hold it forever.
    const allGone = crossing.turned >= crossing.total && this.realTime - crossing.lastTurn > 0.5;
    if (!this.cut && k >= CROSS_MOVE && (allGone || k >= CROSS_MOVE + 6)) this._enterSky();
  }

  // ------------------------------------------------------------------ loop

  _loop = (now) => {
    this.raf = requestAnimationFrame(this._loop);
    const realDt = this.lastNow === null ? 1 / 60 : Math.min(0.05, (now - this.lastNow) / 1000);
    this.lastNow = now;
    // Only an observer that has actually reported the canvas offscreen stops
    // the loop: hosts that render the page in a hidden document still animate,
    // and the browser throttles the frames itself.
    if (!this.visible) return;
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

    // Once the sky has taken over nothing on the floor is seen again.
    if (!this.cut) {
      const dt = realDt * this._timeScale();
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 240) {
        this._stepSim(STEP);
        this.acc -= STEP;
        steps++;
      }
    }
    this._openCrossing();
    // The words only come up once the camera has arrived, and go as it moves
    // on; the first line, left behind on the floor, goes with the floor.
    const leaving = 1 - smoothstep(0.4, 1.2, this._crossTime());
    this.line.opacity = this.impactReal === null || this.sim.mode === 'split' || this.cut
      ? 0
      : 0.96 * smoothstep(FOCUS_SET, LINE_LIT, this.realTime - this.impactReal) * leaving;
    this.opener.opacity = this.cut ? 0 : 0.9 * (1 - smoothstep(0, 0.5, this._crossTime()));

    this._updateCamera();
    this._updateSky();
    if (!this.cut) {
      this._syncVisuals();
      this._updateGlow();
    }

    const crossing = Number.isFinite(this._crossTime());
    if (this.phase === 'open') {
      if (!crossing && this.sim.asleep && this.juice.settled) {
        this.phase = 'rest';
        this.restTime = 0;
        this._emitPhase();
      }
    } else if (this.phase === 'rest' || this.phase === 'sky') {
      this.restTime += realDt;
      const hold = this.phase === 'sky' ? SKY_HOLD : 3.5;
      if (this.options.autoReplay && this.restTime > hold) this._startDrop(true);
    }
    // The sky keeps twinkling; held still, it only draws while it dissolves in.
    const sky = this.phase === 'sky' && (!this.reducedMotion || this.veil.mesh.visible);
    return this.phase === 'falling' || this.phase === 'open' || sky;
  }

  _render(moving) {
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
    this.opener.dispose();
    this.line.dispose();
    this.sky.dispose();
    this.comets.dispose();
    this.veil.dispose();
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
