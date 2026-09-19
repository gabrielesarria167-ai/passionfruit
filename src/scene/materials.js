import * as THREE from 'three';
import { NOISE_GLSL, BUMP_GLSL } from './glsl.js';

// Colour sets for the two common passionfruit forms. Every value is sRGB hex.
export const VARIETIES = {
  purple: {
    skinDeep: '#130310',
    skinMid: '#3a0b2b',
    skinWarm: '#6b1836',
    skinStem: '#44421f',
    speck: '#d9b4c2',
    blossom: '#2c1a12',
    wrinkle: 1.0,
    skinRoughness: 0.42,
    skinClearcoat: 0.8,
    pithEdge: '#35092a',
    pithBlush: '#d99bb6',
    pithWhite: '#f5efe3',
    pithInner: '#e3cb96',
    pithStain: '#8f4d10',
    pithDeep: '#3a1a06',
    aril: '#f9bd32',
    arilCore: '#ffe08e',
    arilEdge: '#e08a30',
    jelly: '#eb951f',
    jellyCore: '#e39a38',
    jellyEdge: '#b0601e',
    juice: '#f7b334',
    juiceCore: '#ffd27e',
    juiceEdge: '#dd8a34',
    splatCore: '#ffdc98',
  },
  golden: {
    skinDeep: '#a86f06',
    skinMid: '#e2ad17',
    skinWarm: '#f4cf4d',
    skinStem: '#78882a',
    speck: '#fff6d2',
    blossom: '#5a4518',
    wrinkle: 0.22,
    skinRoughness: 0.34,
    skinClearcoat: 0.95,
    pithEdge: '#b98c12',
    pithBlush: '#f2dd9c',
    pithWhite: '#f8f2e0',
    pithInner: '#ebd9a0',
    pithStain: '#a5620f',
    pithDeep: '#452309',
    aril: '#f8b733',
    arilCore: '#ffdc8c',
    arilEdge: '#de8a31',
    jelly: '#ec9a26',
    jellyCore: '#df9a3a',
    jellyEdge: '#b0661f',
    juice: '#f9bd40',
    juiceCore: '#ffda8c',
    juiceEdge: '#e0963a',
    splatCore: '#ffe2a6',
  },
};

function colorUniform(hex) {
  return { value: new THREE.Color(hex) };
}

function injectCommon(shader, extraFragDecl, extraVertDecl = '') {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <common>',
    `#include <common>\n${extraVertDecl}`,
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>\n${extraFragDecl}\n${NOISE_GLSL}\n${BUMP_GLSL}`,
  );
}

function createSkinMaterial() {
  const uniforms = {
    uSkinDeep: colorUniform('#000'),
    uSkinMid: colorUniform('#000'),
    uSkinWarm: colorUniform('#000'),
    uSkinStem: colorUniform('#000'),
    uSpeck: colorUniform('#000'),
    uBlossom: colorUniform('#000'),
    uWrinkle: { value: 1 },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2,
    specularIntensity: 0.55,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectCommon(
      shader,
      `varying vec3 vFruitPos;
       uniform vec3 uSkinDeep; uniform vec3 uSkinMid; uniform vec3 uSkinWarm;
       uniform vec3 uSkinStem; uniform vec3 uSpeck; uniform vec3 uBlossom;
       uniform float uWrinkle;`,
      'varying vec3 vFruitPos;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvFruitPos = position;',
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec3 fp = vFruitPos;
        float polar = acos(clamp(normalize(fp).y, -1.0, 1.0));
        float n1 = pf_snoise(fp * 1.15 + vec3(3.1, -1.7, 0.4));
        float n2 = pf_snoise(fp * 2.9 + vec3(-7.3, 2.2, 5.1));
        float n3 = pf_snoise(fp * 7.5 + vec3(1.3, 9.2, -4.4));
        float mott = clamp(0.5 + 0.34 * n1 + 0.2 * n2 + 0.1 * n3, 0.0, 1.0);
        vec3 skin = mix(uSkinDeep, uSkinMid, smoothstep(0.1, 0.9, mott));
        skin = mix(skin, uSkinWarm, smoothstep(0.25, 0.9, 0.5 + 0.5 * n2) * 0.42 * smoothstep(0.25, 0.75, mott));
        float stemZone = 1.0 - smoothstep(0.1, 0.44, polar);
        skin = mix(skin, uSkinStem, stemZone * (0.55 + 0.3 * n3));
        float blossomZone = smoothstep(PI - 0.075, PI - 0.02, polar);
        skin = mix(skin, uBlossom, blossomZone);
        // lenticels: tiny pale dots, clustered by a low-frequency mask
        vec4 cell = pf_worley(fp * 30.0);
        float density = smoothstep(-0.6, 0.8, pf_snoise(fp * 2.1 + 11.0));
        float present = step(1.0 - (0.22 + 0.45 * density), cell.y);
        float rad = mix(0.1, 0.24, cell.z * cell.z);
        float aa = max(fwidth(cell.x), 1e-4) * 1.2;
        float pfSpeck = present * (1.0 - smoothstep(rad - aa, rad + aa, cell.x));
        skin = mix(skin, uSpeck, pfSpeck * (0.22 + 0.3 * cell.w) * (1.0 - 0.7 * stemZone));
        diffuseColor.rgb *= skin;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (0.75 + 0.5 * (0.5 + 0.5 * n2)) + pfSpeck * 0.2 + stemZone * 0.2, 0.05, 1.0);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        float cr1 = 1.0 - abs(pf_snoise(fp * 1.9 + vec3(4.0, 1.0, -3.0)));
        float cr2 = 1.0 - abs(pf_snoise(fp * 4.2 + vec3(-2.0, 6.0, 1.0)));
        float hgt = -uWrinkle * (0.0034 * pow(cr1, 4.0) + 0.0012 * pow(cr2, 4.0));
        hgt += 0.0012 * pf_snoise(fp * 4.6 + 2.0) + 0.0005 * n3 + 0.0003 * pfSpeck;
        hgt += 0.00022 * pf_snoise(fp * 40.0);
        normal = pf_perturbNormal(-vViewPosition, normal, hgt, faceDirection);`,
      )
      .replace(
        '#include <clearcoat_normal_fragment_begin>',
        /* glsl */ `#include <clearcoat_normal_fragment_begin>
        #ifdef USE_CLEARCOAT
          clearcoatNormal = normalize(mix(clearcoatNormal, normal, 0.85));
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'pf-skin';
  mat.userData.uniforms = uniforms;
  return mat;
}

function createPithMaterial() {
  const uniforms = {
    uPithEdge: colorUniform('#000'),
    uPithBlush: colorUniform('#000'),
    uPithWhite: colorUniform('#000'),
    uPithInner: colorUniform('#000'),
    uPithStain: colorUniform('#000'),
    uPithDeep: colorUniform('#000'),
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.66,
    metalness: 0,
    sheen: 0.35,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color('#fff8ec'),
    specularIntensity: 0.4,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectCommon(
      shader,
      `varying vec3 vFruitPos; varying float vPithT; varying float vPithDepth;
       uniform vec3 uPithEdge; uniform vec3 uPithBlush; uniform vec3 uPithWhite; uniform vec3 uPithInner;
       uniform vec3 uPithStain; uniform vec3 uPithDeep;`,
      'varying vec3 vFruitPos; varying float vPithT; varying float vPithDepth;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvFruitPos = position;\nvPithT = uv.x;\nvPithDepth = uv.y;',
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float t = vPithT;
        float sp = pf_snoise(vFruitPos * 34.0);
        float sp2 = pf_snoise(vFruitPos * 88.0);
        float edge = 0.1 + 0.03 * sp;
        vec3 c = mix(uPithEdge, uPithBlush, smoothstep(edge - 0.03, edge + 0.04, t));
        c = mix(c, uPithWhite, smoothstep(edge + 0.02, edge + 0.34, t));
        c = mix(c, uPithInner, smoothstep(0.72, 1.0, t));
        c *= 0.94 + 0.06 * sp;
        c *= 1.0 - 0.1 * smoothstep(0.45, 0.95, sp2);
        // The inside of the rind is wet: juice clings to it in patches.
        float pfWet = smoothstep(0.5, 0.95, t);
        float pfStain = smoothstep(-0.35, 0.75, pf_snoise(vFruitPos * 5.5 + 3.0) + 0.4 * pf_snoise(vFruitPos * 13.0));
        c = mix(c, uPithStain, pfWet * (0.3 + 0.62 * pfStain));
        c = mix(c, uPithDeep, smoothstep(0.0, 0.16, vPithDepth));
        diffuseColor.rgb *= c;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        float ph = 0.0018 * sp + 0.0009 * sp2;
        normal = pf_perturbNormal(-vViewPosition, normal, ph, faceDirection);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.16 + 0.12 * sp2, pfWet * 0.85);`,
      );
  };
  mat.customProgramCacheKey = () => 'pf-pith';
  mat.userData.wet = true;
  mat.userData.uniforms = uniforms;
  return mat;
}

// Translucent jelly (juice sacs, pulp, loose juice) as two cheap passes instead
// of a transmission pass: `filter` multiplies whatever is already drawn behind
// by the jelly's colour (deeper amber toward the silhouette, where light
// crosses more of it), then `shine` adds the specular, clearcoat and a little
// scattered light on top. Seeds behind stay dark, the rind behind turns gold.
function createJellyPair({ key, scatter, glow, roughness, bump = 0, bumpScale = 1, polygonOffset = false }) {
  const uniforms = { uCoreT: colorUniform('#ffd98c'), uEdgeT: colorUniform('#e0892f') };
  const shineUniforms = { uGlow: { value: glow } };
  const offset = polygonOffset
    ? { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }
    : {};

  const filter = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
    ...offset,
  });
  filter.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPfNormal;\nvarying vec3 vPfView;')
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        vec3 pfN = normal;
        #ifdef USE_INSTANCING
          pfN = mat3(instanceMatrix) * pfN;
        #endif
        vPfNormal = normalize(normalMatrix * pfN);
        vPfView = -mvPosition.xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vPfNormal;\nvarying vec3 vPfView;\nuniform vec3 uCoreT;\nuniform vec3 uEdgeT;',
      )
      .replace(
        '#include <dithering_fragment>',
        /* glsl */ `#include <dithering_fragment>
        float pfCore = smoothstep(0.06, 0.85, abs(dot(normalize(vPfNormal), normalize(vPfView))));
        vec3 pfT = mix(uEdgeT, uCoreT, pfCore);
        #if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
          pfT *= vColor.rgb;
        #endif
        gl_FragColor = vec4(pfT, 1.0);`,
      );
  };
  filter.customProgramCacheKey = () => `${key}-filter`;

  const shine = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness,
    metalness: 0,
    transparent: true,
    depthWrite: true,
    fog: false,
    blending: THREE.AdditiveBlending,
    specularIntensity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.4,
    ...offset,
  });
  shine.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shineUniforms);
    injectCommon(shader, 'varying vec3 vPulpPos;\nuniform float uGlow;', 'varying vec3 vPulpPos;');
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvPulpPos = position;',
    );
    const bumpCode = bump
      ? /* glsl */ `float pb = ${bump.toFixed(5)} * pf_snoise(vPulpPos * ${bumpScale.toFixed(2)})
          + ${(bump * 0.35).toFixed(5)} * pf_snoise(vPulpPos * ${(bumpScale * 2.7).toFixed(2)} + 5.0);
        normal = pf_perturbNormal(-vViewPosition, normal, pb, faceDirection);`
      : '';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${bumpCode}`)
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `vec3 pfShine = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
        #ifdef USE_CLEARCOAT
          pfShine += (clearcoatSpecularDirect + clearcoatSpecularIndirect) * material.clearcoat;
        #endif
        float pfCore = smoothstep(0.06, 0.85, abs(dot(normal, normalize(vViewPosition))));
        pfShine += (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) * ${scatter.toFixed(3)} * (1.0 - 0.75 * pfCore);
        pfShine += diffuseColor.rgb * uGlow;
        outgoingLight = pfShine;
        diffuseColor.a = 1.0;
        #include <opaque_fragment>`,
      );
  };
  shine.customProgramCacheKey = () => `${key}-shine`;

  return {
    filter,
    shine,
    set(core, edge, body) {
      uniforms.uCoreT.value.set(core);
      uniforms.uEdgeT.value.set(edge);
      shine.color.set(body);
    },
    set glow(v) {
      shineUniforms.uGlow.value = v;
    },
    get glow() {
      return shineUniforms.uGlow.value;
    },
    dispose() {
      filter.dispose();
      shine.dispose();
    },
  };
}

function createSeedMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#0c0705'),
    roughness: 0.38,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.25,
    specularIntensity: 0.5,
  });
  mat.onBeforeCompile = (shader) => {
    injectCommon(shader, 'varying vec3 vSeedPos;', 'varying vec3 vSeedPos;');
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvSeedPos = position;',
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec4 pc = pf_worley(vSeedPos * 62.0);
        float pit = 1.0 - smoothstep(0.12, 0.48, pc.x);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.55, 1.28, 1.05), (1.0 - pit) * 0.55);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        normal = pf_perturbNormal(-vViewPosition, normal, -0.0022 * pit, faceDirection);`,
      );
  };
  mat.customProgramCacheKey = () => 'pf-seed';
  return mat;
}

function createStemMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.78,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    injectCommon(shader, 'varying vec2 vStemUv; varying vec3 vStemPos;', 'varying vec2 vStemUv; varying vec3 vStemPos;');
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvStemUv = uv;\nvStemPos = position;',
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float fib = sin(vStemUv.x * 6.2831853 * 15.0 + 2.5 * pf_snoise(vec3(vStemUv.x * 6.0, vStemUv.y * 14.0, 1.7)));
        float blot = pf_snoise(vStemPos * 42.0);
        diffuseColor.rgb *= 0.86 + 0.1 * fib + 0.06 * blot;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        normal = pf_perturbNormal(-vViewPosition, normal, 0.0012 * fib + 0.0008 * blot, faceDirection);`,
      );
  };
  mat.customProgramCacheKey = () => 'pf-stem';
  return mat;
}

// A smooth, matte sweep: no texture and no specular, so a light close to the
// floor spreads as an even pool instead of a streak.
function createGroundMaterial() {
  return new THREE.MeshLambertMaterial({ color: 0xffffff });
}

// Two instanced meshes (filter + shine) drawing the same instances.
export function createJellyInstances(geometry, pair, count, renderOrder) {
  const filter = new THREE.InstancedMesh(geometry, pair.filter, count);
  const shine = new THREE.InstancedMesh(geometry, pair.shine, count);
  shine.instanceMatrix = filter.instanceMatrix;
  filter.renderOrder = renderOrder;
  shine.renderOrder = renderOrder + 1;
  shine.receiveShadow = true;
  return {
    filter,
    shine,
    meshes: [filter, shine],
    setMatrixAt(i, m) {
      filter.setMatrixAt(i, m);
    },
    setColorAt(i, c) {
      filter.setColorAt(i, c);
      shine.instanceColor = filter.instanceColor;
    },
    set count(n) {
      filter.count = n;
      shine.count = n;
    },
    get count() {
      return filter.count;
    },
    commit() {
      filter.instanceMatrix.needsUpdate = true;
      if (filter.instanceColor) filter.instanceColor.needsUpdate = true;
      filter.computeBoundingSphere();
      shine.boundingSphere = filter.boundingSphere;
    },
  };
}

export function createMaterials() {
  const m = {
    skin: createSkinMaterial(),
    pith: createPithMaterial(),
    aril: createJellyPair({ key: 'pf-aril', scatter: 0.1, glow: 0.015, roughness: 0.06, bump: 0.0005, bumpScale: 9 }),
    jelly: createJellyPair({ key: 'pf-jelly', scatter: 0.05, glow: 0.01, roughness: 0.1, bump: 0.0008, bumpScale: 7 }),
    seed: createSeedMaterial(),
    stem: createStemMaterial(),
    ground: createGroundMaterial(),
    juice: createJellyPair({ key: 'pf-juice', scatter: 0.08, glow: 0.02, roughness: 0.03 }),
    splat: createJellyPair({ key: 'pf-splat', scatter: 0.04, glow: 0.01, roughness: 0.03, polygonOffset: true }),
  };

  for (const key of ['aril', 'jelly', 'juice', 'splat']) m[key].baseGlow = m[key].glow;

  m.applyVariety = (name) => {
    const v = VARIETIES[name] || VARIETIES.purple;
    const su = m.skin.userData.uniforms;
    su.uSkinDeep.value.set(v.skinDeep);
    su.uSkinMid.value.set(v.skinMid);
    su.uSkinWarm.value.set(v.skinWarm);
    su.uSkinStem.value.set(v.skinStem);
    su.uSpeck.value.set(v.speck);
    su.uBlossom.value.set(v.blossom);
    su.uWrinkle.value = v.wrinkle;
    m.skin.roughness = v.skinRoughness;
    m.skin.clearcoat = v.skinClearcoat;
    const pu = m.pith.userData.uniforms;
    pu.uPithEdge.value.set(v.pithEdge);
    pu.uPithBlush.value.set(v.pithBlush);
    pu.uPithWhite.value.set(v.pithWhite);
    pu.uPithInner.value.set(v.pithInner);
    pu.uPithStain.value.set(v.pithStain);
    pu.uPithDeep.value.set(v.pithDeep);
    m.aril.set(v.arilCore, v.arilEdge, v.aril);
    m.jelly.set(v.jellyCore, v.jellyEdge, v.jelly);
    m.juice.set(v.juiceCore, v.juiceEdge, v.juice);
    m.splat.set(v.splatCore, v.juiceEdge, v.juice);
  };

  m.dispose = () => {
    for (const key of Object.keys(m)) {
      const v = m[key];
      if (v && (v.isMaterial || v.filter)) v.dispose();
    }
  };

  return m;
}
