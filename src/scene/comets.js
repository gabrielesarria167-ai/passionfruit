import * as THREE from 'three';

// What the rind becomes in the sky: each piece still falling when the night
// reaches it catches light and keeps falling, a comet drawing its tail out
// behind it. Comets live in sky coordinates beside the stars (add both
// objects to the star field) and move along great circles. Like the pieces
// they were, they are drawn over the floor.

const MAX = 48;
const SEG = 36; // samples along a tail
const RADIUS = 50; // the stars' sphere

const tailVertex = /* glsl */ `
  attribute vec3 aNext;
  attribute float aSide;
  attribute float aT;
  attribute float aWidth;
  attribute float aAlpha;
  uniform vec2 uResolution;
  uniform float uPixelRatio;
  varying float vT;
  varying float vSide;
  varying float vAlpha;

  void main() {
    // A ribbon a few pixels wide, laid along the tail on screen.
    vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec4 b = projectionMatrix * modelViewMatrix * vec4(aNext, 1.0);
    vec2 half_ = 0.5 * uResolution;
    vec2 d = (b.xy / b.w - a.xy / a.w) * half_;
    float len = length(d);
    vec2 n = len > 1e-5 ? vec2(-d.y, d.x) / len : vec2(0.0, 1.0);
    float w = aWidth * uPixelRatio * (0.8 + 2.6 * aT);
    a.xy += n * (w * aSide / half_) * a.w;
    gl_Position = a;
    vT = aT;
    vSide = aSide;
    vAlpha = aAlpha;
  }
`;

const tailFragment = /* glsl */ `
  uniform vec3 uHead;
  uniform vec3 uWarm;
  uniform vec3 uTail;
  varying float vT;
  varying float vSide;
  varying float vAlpha;

  void main() {
    // Soft across, brightest at the head and thinning out along its length:
    // white-hot, then the warm of the pulp, then the colour of the rind.
    float across = exp(-2.6 * vSide * vSide);
    float along = pow(1.0 - vT, 1.5);
    vec3 col = mix(uHead, uWarm, smoothstep(0.0, 0.25, vT));
    col = mix(col, uTail, smoothstep(0.2, 0.75, vT));
    gl_FragColor = vec4(col * across * along * vAlpha * 0.9, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const headVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aGlow;
  uniform float uPixelRatio;
  varying float vSigma;
  varying float vAlpha;
  varying float vGlow;
  varying float vExtent;

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vSigma = aSize * uPixelRatio;
    vGlow = aGlow * uPixelRatio;
    vAlpha = aAlpha;
    vExtent = max(9.0 * vSigma, 1.6 * vGlow) + 1.0;
    gl_PointSize = 2.0 * vExtent;
  }
`;

const headFragment = /* glsl */ `
  uniform vec3 uHead;
  uniform vec3 uTail;
  varying float vSigma;
  varying float vAlpha;
  varying float vGlow;
  varying float vExtent;

  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0 * vExtent;
    float core = 1.6 * exp(-0.5 * r * r / (vSigma * vSigma));
    float coma = 0.35 * exp(-r / (2.5 * vSigma));
    // While it is still the size of the piece of rind it was, a soft glow.
    float g = max(vGlow, 0.5);
    float glow = vGlow > 0.0 ? 0.35 * (1.0 - smoothstep(0.2 * g, g, r)) : 0.0;
    vec3 col = uHead * (core + coma) + mix(uHead, uTail, 0.4) * glow;
    // Ease the coma out before the edge of the sprite, which would otherwise
    // show round a big head as a faint square.
    col *= 1.0 - smoothstep(0.6 * vExtent, vExtent, r);
    gl_FragColor = vec4(col * vAlpha, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const _p = new THREE.Vector3();
const _u = new THREE.Vector3();

export class Comets {
  constructor() {
    const verts = MAX * (SEG + 1) * 2;
    const tail = new THREE.BufferGeometry();
    this.tailPos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.tailNext = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.tailWidth = new THREE.BufferAttribute(new Float32Array(verts), 1);
    this.tailAlpha = new THREE.BufferAttribute(new Float32Array(verts), 1);
    const side = new Float32Array(verts);
    const t = new Float32Array(verts);
    const index = [];
    for (let c = 0; c < MAX; c++) {
      for (let i = 0; i <= SEG; i++) {
        const v = (c * (SEG + 1) + i) * 2;
        side[v] = -1;
        side[v + 1] = 1;
        t[v] = t[v + 1] = i / SEG;
        if (i < SEG) index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    tail.setAttribute('position', this.tailPos);
    tail.setAttribute('aNext', this.tailNext);
    tail.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    tail.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    tail.setAttribute('aWidth', this.tailWidth);
    tail.setAttribute('aAlpha', this.tailAlpha);
    tail.setIndex(index);

    const heads = new THREE.BufferGeometry();
    this.headPos = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3);
    this.headSize = new THREE.BufferAttribute(new Float32Array(MAX), 1);
    this.headAlpha = new THREE.BufferAttribute(new Float32Array(MAX), 1);
    this.headGlow = new THREE.BufferAttribute(new Float32Array(MAX), 1);
    heads.setAttribute('position', this.headPos);
    heads.setAttribute('aSize', this.headSize);
    heads.setAttribute('aAlpha', this.headAlpha);
    heads.setAttribute('aGlow', this.headGlow);
    this.dynamic = [this.tailPos, this.tailNext, this.tailWidth, this.tailAlpha, this.headPos, this.headSize, this.headAlpha, this.headGlow];
    for (const attr of this.dynamic) attr.setUsage(THREE.DynamicDrawUsage);
    this.geometries = [tail, heads];

    this.uniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uPixelRatio: { value: 1 },
      uHead: { value: new THREE.Color('#fff1de').multiplyScalar(1.4) },
      uWarm: { value: new THREE.Color('#ffb24d') },
      uTail: { value: new THREE.Color('#c65a92') },
    };
    const common = {
      uniforms: this.uniforms,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    };
    this.tailMaterial = new THREE.ShaderMaterial({ ...common, side: THREE.DoubleSide, vertexShader: tailVertex, fragmentShader: tailFragment });
    this.headMaterial = new THREE.ShaderMaterial({ ...common, vertexShader: headVertex, fragmentShader: headFragment });
    this.tails = new THREE.Mesh(tail, this.tailMaterial);
    this.heads = new THREE.Points(heads, this.headMaterial);
    for (const o of [this.tails, this.heads]) {
      o.frustumCulled = false;
      o.renderOrder = -8;
    }

    this.list = [];
    for (let i = 0; i < MAX; i++) {
      this.list.push({ alive: false, p0: new THREE.Vector3(), u: new THREE.Vector3() });
    }
    this.reset();
  }

  set tint(color) {
    this.uniforms.uTail.value.set(color);
  }

  reset() {
    for (const c of this.list) c.alive = false;
    this.used = 0;
    this.update(0);
  }

  // A comet starting at sky direction `dir` and heading along `heading` (a
  // sky vector), at `speed` radians a second easing to `cruise`. `glow` is
  // the radius in CSS pixels of the piece it takes over.
  launch({ time, dir, speed, heading, cruise, glow, bright, size, tail, life }) {
    if (this.used >= MAX) return;
    const c = this.list[this.used++];
    c.alive = true;
    c.born = time;
    c.p0.copy(dir).normalize();
    c.u.copy(heading).addScaledVector(c.p0, -heading.dot(c.p0));
    if (c.u.lengthSq() < 1e-8) c.u.set(0, -1, 0).addScaledVector(c.p0, c.p0.y);
    c.u.normalize();
    c.w0 = speed;
    c.w1 = cruise;
    c.glow = glow;
    c.bright = bright;
    c.size = size;
    c.tail = tail;
    c.life = life;
  }

  update(time, pixelRatio = 1, width = 1, height = 1) {
    this.uniforms.uPixelRatio.value = pixelRatio;
    this.uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio);
    const pos = this.tailPos.array;
    const next = this.tailNext.array;
    const width_ = this.tailWidth.array;
    const alpha = this.tailAlpha.array;
    this.list.forEach((c, k) => {
      const age = c.alive ? time - c.born : -1;
      const on = age >= 0 && age < c.life;
      const base = k * (SEG + 1) * 2;
      if (!on) {
        for (let v = base; v < base + (SEG + 1) * 2; v++) {
          width_[v] = 0;
          alpha[v] = 0;
        }
        this.headAlpha.array[k] = 0;
        this.headGlow.array[k] = 0;
        return;
      }
      // It moves on at the pace it had when it caught light, then gathers
      // speed into its fall.
      const tau = 0.9;
      const theta = c.w1 * age + (c.w0 - c.w1) * tau * (1 - Math.exp(-age / tau));
      const reach = Math.min(c.tail, theta);
      const a = c.bright * smooth(0, 0.35, age) * (1 - smooth(c.life - 1.6, c.life, age));
      for (let i = 0; i <= SEG; i++) {
        const phi = theta - reach * (i / SEG);
        const v = base + i * 2;
        this._at(c, phi, _p);
        // The neighbour further down the tail (past its end, for the last).
        this._at(c, phi - Math.max(reach, 1e-3) / SEG, _u);
        for (const s of [v, v + 1]) {
          _p.toArray(pos, s * 3);
          _u.toArray(next, s * 3);
          width_[s] = c.size;
          alpha[s] = a;
        }
      }
      this._at(c, theta, _p).toArray(this.headPos.array, k * 3);
      this.headSize.array[k] = 0.7 + 0.5 * c.size;
      this.headAlpha.array[k] = a;
      this.headGlow.array[k] = c.glow * (1 - smooth(0, 0.8, age));
    });
    for (const attr of this.dynamic) attr.needsUpdate = true;
  }

  _at(c, phi, out) {
    return out.copy(c.p0).multiplyScalar(Math.cos(phi)).addScaledVector(c.u, Math.sin(phi)).multiplyScalar(RADIUS);
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    this.tailMaterial.dispose();
    this.headMaterial.dispose();
  }
}

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
