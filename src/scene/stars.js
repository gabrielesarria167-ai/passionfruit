import * as THREE from 'three';
import { STAR_COUNT, STAR_DATA } from './starCatalog.js';

// The sky the pulp turns into: the Yale Bright Star Catalogue, every star the
// eye can see on a dark night, at its real position, brightness and colour.

// Blackbody colours in sRGB (D65 white, CIE 1931 2° observer), after Mitchell
// Charity's table: [kelvin, r, g, b].
const BLACKBODY = [
  [1000, 255, 56, 0], [1500, 255, 109, 0], [2000, 255, 137, 18], [2500, 255, 161, 72],
  [3000, 255, 180, 107], [3500, 255, 196, 137], [4000, 255, 209, 163], [4500, 255, 219, 186],
  [5000, 255, 228, 206], [5500, 255, 236, 224], [6000, 255, 243, 239], [6500, 255, 249, 253],
  [7000, 245, 243, 255], [8000, 227, 233, 255], [9000, 214, 225, 255], [10000, 204, 219, 255],
  [12000, 191, 211, 255], [15000, 179, 204, 255], [20000, 168, 197, 255], [30000, 159, 191, 255],
  [40000, 155, 188, 255],
];

// Effective temperature from the B-V colour index (Ballesteros 2012).
const bvToKelvin = (bv) => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));

function blackbody(kelvin, out) {
  const t = Math.min(40000, Math.max(1000, kelvin));
  let i = 1;
  while (i < BLACKBODY.length - 1 && BLACKBODY[i][0] < t) i++;
  const a = BLACKBODY[i - 1];
  const b = BLACKBODY[i];
  const f = (t - a[0]) / (b[0] - a[0]);
  return out.setRGB(
    (a[1] + (b[1] - a[1]) * f) / 255,
    (a[2] + (b[2] - a[2]) * f) / 255,
    (a[3] + (b[3] - a[3]) * f) / 255,
    THREE.SRGBColorSpace,
  );
}

// Right ascension and declination (J2000) to a direction with celestial north
// up (+y). Seen from inside the sphere the constellations read the right way
// round.
function equatorial(ra, dec, out) {
  const c = Math.cos(dec);
  return out.set(c * Math.cos(ra), Math.sin(dec), -c * Math.sin(ra));
}

function decode() {
  const bin = atob(STAR_DATA);
  const view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  const u = (i, k) => view.getUint16(i * 8 + k, true);
  const stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      ra: (u(i, 0) / 65535) * Math.PI * 2,
      dec: (u(i, 2) / 65535) * Math.PI - Math.PI / 2,
      mag: u(i, 4) / 1000 - 2,
      bv: u(i, 6) / 10000 - 1,
    });
  }
  return stars;
}

// The sky is turned so that the camera settles on Orion: on Alnilam, the
// middle of the belt, or a little past it towards Sirius when the frame is
// wide enough to hold both.
const hms = (h, m, s) => ((h + m / 60 + s / 3600) / 24) * Math.PI * 2;
const dms = (d, m, s) => Math.sign(d || -1) * (Math.abs(d) + m / 60 + s / 3600) * (Math.PI / 180);
const ALNILAM = { ra: hms(5, 36, 12.8), dec: dms(-1, 12, 6.9) };
const SIRIUS = { ra: hms(6, 45, 8.9), dec: dms(-16, 42, 58) };

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute float aMag;
  attribute float aSeed;
  attribute vec3 aFrom;
  attribute float aPartner;
  attribute float aMorph;
  attribute float aPulp;
  attribute float aGlow;
  uniform float uTime;
  uniform float uReveal;
  uniform float uPixelRatio;
  uniform float uTwinkle;
  uniform float uOpacity;
  uniform float uNight;
  varying vec3 vColor;
  varying float vPeak;
  varying float vSigma;
  varying float vHalo;
  varying float vHaloR;
  varying float vExtent;
  varying float vDisc;
  varying float vM;
  varying float vPulpGain;
  varying float vGlow;

  void main() {
    // A star that takes over a drop starts where the drop is and falls into
    // place; the rest come up as the eye adapts, brightest first, once the
    // night has reached their part of the frame.
    bool partner = aPartner > 0.5;
    float m = partner ? aMorph : 1.0;
    vec3 dir = normalize(position);
    if (m < 1.0) dir = normalize(mix(aFrom, dir, m));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(dir * 50.0, 1.0);

    float adapt = 0.75 * clamp((aMag + 1.5) / 8.0, 0.0, 1.0);
    float reveal = 1.0;
    if (!partner) {
      reveal = smoothstep(adapt, adapt + 0.25, uReveal);
      reveal *= 1.0 - smoothstep(uNight - 0.3, uNight + 0.02, gl_Position.y / gl_Position.w);
    }

    // Peak brightness follows the catalogue magnitude (a 3rd-magnitude star
    // just fills the pixel). Past that the core spreads and a halo comes up,
    // the way a bright star blooms on a sensor.
    float peak = pow(10.0, -0.24 * (aMag - 3.0));
    float scint = sin(uTime * (5.0 + 9.0 * aSeed) + aSeed * 61.0) * sin(uTime * (1.3 + 2.1 * aSeed) + aSeed * 17.0);
    peak *= 1.0 + uTwinkle * scint;
    float over = log2(max(peak, 1.0));
    float sigma = 0.8 * uPixelRatio * (1.0 + 0.4 * over);
    float halo = max(peak - 0.8, 0.0) * 0.035;
    float haloR = 4.0 * uPixelRatio * (1.0 + 0.45 * over);
    float extent = max(3.2 * sigma, halo > 0.0 ? 4.0 * haloR : 0.0);

    // The drop as the camera last saw it, shrinking to its star, and the star
    // it becomes. Both are drawn in a pass of their own, over the floor, so a
    // piece that turns while the floor is still there goes straight into a
    // star instead of behind it; the main pass leaves those stars out.
    float disc = aPulp * uPixelRatio;
    vPulpGain = 0.55 + 0.9 * fract(aSeed * 7.31);
    vGlow = aGlow;
    #ifdef EMBERS
      bool drawn = partner;
    #else
      bool drawn = !partner;
    #endif
    if (!drawn) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    #ifdef EMBERS
      extent = max(extent, disc * 2.2 + 1.0);
    #endif

    vColor = aColor;
    vPeak = min(peak, 10.0) * reveal * uOpacity;
    vSigma = sigma;
    vHalo = halo * reveal * uOpacity;
    vHaloR = haloR;
    vExtent = extent;
    vDisc = disc;
    vM = m;
    gl_PointSize = 2.0 * extent;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uPulp;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vPeak;
  varying float vSigma;
  varying float vHalo;
  varying float vHaloR;
  varying float vExtent;
  varying float vDisc;
  varying float vM;
  varying float vPulpGain;
  varying float vGlow;

  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0 * vExtent;
    float star = vPeak * exp(-0.5 * r * r / (vSigma * vSigma)) + vHalo * exp(-r / vHaloR);
    vec3 col = vColor * star * vM;
    #ifdef EMBERS
      // The drop lit from inside: a hot core in a soft body of light.
      float d = max(vDisc, 0.5);
      float core = exp(-0.5 * r * r / (0.2 * d * d));
      float body = 1.0 - smoothstep(0.45 * d, d, r);
      col += uPulp * (0.8 * core + 0.5 * body) * vPulpGain * vGlow * uOpacity;
    #endif
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _white = new THREE.Color();

export class StarField {
  constructor() {
    const stars = decode();
    this.count = stars.length;
    this.mags = new Float32Array(this.count);
    const pos = new Float32Array(this.count * 3);
    const color = new Float32Array(this.count * 3);
    const seed = new Float32Array(this.count);
    const c = new THREE.Color();
    // Deterministic per-star noise, so the sky twinkles the same way each time.
    let s = 0x9e3779b9;
    const rand = () => {
      s = (s ^ (s << 13)) >>> 0;
      s = (s ^ (s >>> 17)) >>> 0;
      s = (s ^ (s << 5)) >>> 0;
      return s / 4294967296;
    };
    stars.forEach((star, i) => {
      equatorial(star.ra, star.dec, _v).toArray(pos, i * 3);
      // Stars look paler to the eye than their blackbody colour.
      blackbody(bvToKelvin(star.bv), c).lerp(_white.setRGB(1, 1, 1), 0.2).toArray(color, i * 3);
      this.mags[i] = star.mag;
      seed[i] = rand();
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aMag', new THREE.BufferAttribute(this.mags, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.from = new THREE.BufferAttribute(new Float32Array(this.count * 3), 3);
    this.partner = new THREE.BufferAttribute(new Float32Array(this.count), 1);
    this.morph = new THREE.BufferAttribute(new Float32Array(this.count).fill(1), 1);
    this.pulp = new THREE.BufferAttribute(new Float32Array(this.count), 1);
    this.glow = new THREE.BufferAttribute(new Float32Array(this.count), 1);
    this.handoff = [this.from, this.partner, this.morph, this.pulp, this.glow];
    for (const attr of this.handoff) attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFrom', this.from);
    geo.setAttribute('aPartner', this.partner);
    geo.setAttribute('aMorph', this.morph);
    geo.setAttribute('aPulp', this.pulp);
    geo.setAttribute('aGlow', this.glow);
    this.geometry = geo;

    this.uniforms = {
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uPixelRatio: { value: 1 },
      uTwinkle: { value: 0.12 },
      uOpacity: { value: 1 },
      uNight: { value: 3 },
      uPulp: { value: new THREE.Color('#ffb24d').multiplyScalar(1.3) },
    };
    // Drawn before anything else and without depth, so the set covers the sky
    // for as long as it is still in the frame. The drops turning into stars
    // are drawn again, as glows, once the floor behind them is down (the
    // scene puts it between the two).
    const params = {
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    };
    this.material = new THREE.ShaderMaterial(params);
    this.emberMaterial = new THREE.ShaderMaterial({ ...params, defines: { EMBERS: '' } });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -10;
    this.points.visible = false;
    this.embers = new THREE.Points(geo, this.emberMaterial);
    this.embers.frustumCulled = false;
    this.embers.renderOrder = -8;
    this.points.add(this.embers);
    this.offset = new THREE.Quaternion();
    this.candidates = [];
    this.spares = [];
    this.aim(0);
  }

  // Where the sky sits relative to the camera: Orion ahead with celestial
  // north at the top; `towardSirius` (0-1) moves the aim along the way to
  // Sirius.
  aim(towardSirius) {
    const fwd = equatorial(ALNILAM.ra, ALNILAM.dec, new THREE.Vector3())
      .lerp(equatorial(SIRIUS.ra, SIRIUS.dec, _v), towardSirius)
      .normalize();
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(fwd, -fwd.y).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, up);
    this.offset.setFromRotationMatrix(_m.makeBasis(right, up, fwd.clone().negate())).invert();
  }

  // Turn the sky so that a camera with this orientation looks at Orion.
  frame(cameraQuaternion) {
    this.points.quaternion.copy(cameraQuaternion).multiply(this.offset);
  }

  // Sky coordinates of a world direction, for the sky as it is framed now.
  toSky(worldDir, out) {
    return out.copy(worldDir).applyQuaternion(_q.copy(this.points.quaternion).invert());
  }

  // Forget every drop taken over, and gather the stars (to magnitude 6.5)
  // the camera will see once it has settled: the ones drops can become. Stars
  // well out of that frame are kept to carry the drops that find no star.
  gather(fov, aspect, margin = 1.1) {
    for (const attr of this.handoff) attr.array.fill(0);
    this.morph.array.fill(1);
    this.dirty = true;
    this.candidates.length = 0;
    this.spares.length = 0;
    this.tanV = Math.tan((fov * Math.PI) / 360);
    this.tanH = this.tanV * aspect;
    const pos = this.geometry.attributes.position;
    const at = [0, 0];
    for (let i = 0; i < this.count; i++) {
      _v.fromBufferAttribute(pos, i).normalize();
      const inFrame = this.frameOf(_v, at) && Math.abs(at[0]) < margin && Math.abs(at[1]) < margin;
      if (inFrame && this.mags[i] < 6.5) this.candidates.push({ i, dir: _v.clone(), mag: this.mags[i], taken: false });
      else if (!this.frameOf(_v, at) || Math.abs(at[0]) > 2 || Math.abs(at[1]) > 2) this.spares.push(i);
    }
  }

  // Where a sky direction lands in the settled frame, as [x, y] from -1 to 1
  // across it; false when it is behind the camera.
  frameOf(dir, out) {
    _w.copy(dir).applyQuaternion(this.offset);
    if (_w.z > -0.1) return false;
    out[0] = _w.x / -_w.z / this.tanH;
    out[1] = _w.y / -_w.z / this.tanV;
    return true;
  }

  // The sky direction at [x, y] in the settled frame.
  dirOf(x, y, out) {
    return out.set(x * this.tanH, y * this.tanV, -1).normalize().applyQuaternion(_q.copy(this.offset).invert());
  }

  // The nearest free star within `maxAngle` of a sky direction whose
  // magnitude falls in [minMag, maxMag], or -1.
  claim(dir, minMag, maxMag, maxAngle) {
    let best = null;
    let bestDot = Math.cos(maxAngle);
    for (const c of this.candidates) {
      if (c.taken || c.mag < minMag || c.mag > maxMag) continue;
      const d = c.dir.dot(dir);
      if (d > bestDot) {
        bestDot = d;
        best = c;
      }
    }
    if (!best) return -1;
    best.taken = true;
    this.partner.array[best.i] = 1;
    this.dirty = true;
    return best.i;
  }

  // A star out of sight to carry a drop that has no star to become: it
  // never leaves the drop, and only its glow is ever seen.
  spare() {
    const i = this.spares.pop();
    if (i === undefined) return -1;
    this.partner.array[i] = 1;
    this.dirty = true;
    return i;
  }

  // Star `i` is `m` (0-1) of the way from the drop, seen in sky direction
  // `from`, to its own place; the drop still shows as a glow `radius` CSS
  // pixels across at `glow` of its brightness.
  hold(i, from, m, radius, glow) {
    from.toArray(this.from.array, i * 3);
    this.morph.array[i] = m;
    this.pulp.array[i] = radius;
    this.glow.array[i] = glow;
    this.dirty = true;
  }

  commit() {
    if (!this.dirty) return;
    this.dirty = false;
    for (const attr of this.handoff) attr.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.emberMaterial.dispose();
  }
}
