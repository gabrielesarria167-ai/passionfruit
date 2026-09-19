// Shared GLSL: simplex noise (Ashima Arts / Ian McEwan, MIT), cellular noise and
// derivative-based bump mapping (Mikkelsen) for procedural surface detail.

export const NOISE_GLSL = /* glsl */ `
vec3 pf_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 pf_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 pf_permute(vec4 x) { return pf_mod289(((x * 34.0) + 10.0) * x); }
vec4 pf_taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float pf_snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = pf_mod289(i);
  vec4 p = pf_permute(pf_permute(pf_permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = pf_taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec3 pf_hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// Cellular noise. x: distance to the nearest feature point (cell units),
// yzw: three random values belonging to that feature point. Searches only the
// 2x2x2 block of cells nearest p: exact for distances below 0.6, which covers
// every use here (dots and pits never exceed a radius of 0.5).
vec4 pf_worley(vec3 p) {
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  vec3 base = ip + step(0.5, fp) - 1.0;
  float best = 8.0;
  vec3 bestCell = ip;
  for (int k = 0; k <= 1; k++)
  for (int j = 0; j <= 1; j++)
  for (int i = 0; i <= 1; i++) {
    vec3 cell = base + vec3(float(i), float(j), float(k));
    vec3 r = cell + 0.1 + 0.8 * pf_hash33(cell) - p;
    float d = dot(r, r);
    if (d < best) {
      best = d;
      bestCell = cell;
    }
  }
  return vec4(sqrt(best), pf_hash33(bestCell + 71.37));
}
`;

export const BUMP_GLSL = /* glsl */ `
// Perturbs a view-space normal by a scalar height field (in scene units),
// using screen-space derivatives so no tangents or UVs are needed.
vec3 pf_perturbNormal(vec3 surfPos, vec3 surfNorm, float height, float faceDir) {
  vec3 dpdx = dFdx(surfPos);
  vec3 dpdy = dFdy(surfPos);
  float dhdx = dFdx(height);
  float dhdy = dFdy(height);
  vec3 r1 = cross(dpdy, surfNorm);
  vec3 r2 = cross(surfNorm, dpdx);
  float det = dot(dpdx, r1) * faceDir;
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;
