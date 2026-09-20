import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

// Seamless studio sweeps. `bg` is both the clear colour and the fog colour so
// the floor dissolves into the backdrop without a horizon line.
export const BACKDROPS = {
  // Almost nothing shines on the night set: the fruit lights it.
  night: {
    bg: '#050405', floor: '#0c0a0b', hemiSky: '#f3e7ef', key: 4.2, rim: 4.4, hemi: 0.09, env: 0.3,
    shadowOpacity: 0.35, keyShadow: 0.85, exposure: 1.12, glow: 1,
    // A follow spot picks the fruit out of the dark on the way down.
    keyFall: 38, keyAngle: 0.34,
  },
  pith: {
    bg: '#e4d9c8', floor: '#ece2d2', hemiSky: '#fff7ea', key: 3.3, rim: 1.4, hemi: 0.55, env: 0.95,
    shadowOpacity: 0.62, keyShadow: 0.78, exposure: 1.0,
  },
  lilac: {
    bg: '#cbbdd0', floor: '#d6c9da', hemiSky: '#fbf4ff', key: 3.2, rim: 1.5, hemi: 0.55, env: 0.95,
    shadowOpacity: 0.62, keyShadow: 0.78, exposure: 1.0,
  },
  aubergine: {
    bg: '#140b12', floor: '#2b1a26', hemiSky: '#f3e3ea', key: 4.4, rim: 2.8, hemi: 0.18, env: 0.62,
    shadowOpacity: 0.85, keyShadow: 0.9, exposure: 1.05,
  },
};

function softbox(scene, { w, h, intensity, color = '#ffffff', position, target = [0, 0, 0] }) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.set(...position);
  mesh.lookAt(...target);
  scene.add(mesh);
}

// A small photo studio rendered into a prefiltered environment map: a big key
// softbox, a strip light for the rim, a ceiling bounce and a warm floor.
function createStudioEnvironment(renderer) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(30, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vDir; void main(){
        float up = vDir.y;
        vec3 floorC = vec3(0.34, 0.29, 0.25);
        vec3 wallC = vec3(0.2, 0.19, 0.19);
        vec3 ceilC = vec3(0.42, 0.41, 0.4);
        vec3 c = mix(wallC, ceilC, smoothstep(0.1, 0.9, up));
        c = mix(floorC, c, smoothstep(-0.25, 0.05, up));
        gl_FragColor = vec4(c, 1.0);
      }`,
    }),
  );
  env.add(room);
  softbox(env, { w: 9, h: 6, intensity: 7, color: '#fff6ea', position: [-7, 11, 8] });
  softbox(env, { w: 2.2, h: 10, intensity: 9, color: '#f4f2ff', position: [9, 6, -8] });
  softbox(env, { w: 14, h: 14, intensity: 1.8, color: '#fffaf2', position: [0, 16, 0] });
  softbox(env, { w: 6, h: 4, intensity: 1.4, color: '#ffe9d6', position: [-12, 3, -2] });
  softbox(env, { w: 3, h: 3, intensity: 4, color: '#ffffff', position: [4, 9, 10] });
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.03);
  pmrem.dispose();
  env.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
  return rt;
}

// Soft grounding shadow in the style of three.js' contact-shadow example: the
// casters are rendered from below into a depth-darkness texture and blurred.
class ContactShadow {
  constructor(renderer, { size = 9, resolution = 768, height = 1.5, blur = 2.8 } = {}) {
    this.renderer = renderer;
    this.blur = blur;
    this.group = new THREE.Group();
    this.group.position.y = 0.0012;
    const opts = { type: THREE.HalfFloatType };
    this.rt = new THREE.WebGLRenderTarget(resolution, resolution, opts);
    this.rt.texture.generateMipmaps = false;
    this.rtBlur = new THREE.WebGLRenderTarget(resolution, resolution, opts);
    this.rtBlur.texture.generateMipmaps = false;

    const planeGeo = new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2);
    this.material = new THREE.MeshBasicMaterial({
      map: this.rt.texture,
      transparent: true,
      depthWrite: false,
      opacity: 0.6,
    });
    this.plane = new THREE.Mesh(planeGeo, this.material);
    this.plane.renderOrder = 1;
    this.plane.scale.y = -1;
    this.group.add(this.plane);

    this.blurPlane = new THREE.Mesh(planeGeo);
    this.blurPlane.visible = false;
    this.group.add(this.blurPlane);

    this.camera = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, height);
    this.camera.rotation.x = Math.PI / 2;
    this.camera.layers.set(2);
    this.group.add(this.camera);

    this.depthMaterial = new THREE.MeshDepthMaterial();
    this.depthMaterial.userData.darkness = { value: 1.35 };
    this.depthMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.darkness = this.depthMaterial.userData.darkness;
      shader.fragmentShader = `uniform float darkness;\n${shader.fragmentShader.replace(
        'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );',
      )}`;
    };
    this.depthMaterial.depthTest = false;
    this.depthMaterial.depthWrite = false;

    this.hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
    this.hBlur.depthTest = false;
    this.vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
    this.vBlur.depthTest = false;
  }

  blurPass(amount) {
    const r = this.renderer;
    this.blurPlane.visible = true;
    this.blurPlane.material = this.hBlur;
    this.hBlur.uniforms.tDiffuse.value = this.rt.texture;
    this.hBlur.uniforms.h.value = amount / 256;
    r.setRenderTarget(this.rtBlur);
    r.render(this.blurPlane, this.camera);
    this.blurPlane.material = this.vBlur;
    this.vBlur.uniforms.tDiffuse.value = this.rtBlur.texture;
    this.vBlur.uniforms.v.value = amount / 256;
    r.setRenderTarget(this.rt);
    r.render(this.blurPlane, this.camera);
    this.blurPlane.visible = false;
  }

  render(scene) {
    const r = this.renderer;
    const bg = scene.background;
    const fog = scene.fog;
    const clearAlpha = r.getClearAlpha();
    scene.background = null;
    scene.fog = null;
    scene.overrideMaterial = this.depthMaterial;
    r.setClearAlpha(0);
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, this.camera);
    scene.overrideMaterial = null;
    this.blurPass(this.blur);
    this.blurPass(this.blur * 0.4);
    r.setRenderTarget(null);
    r.setClearAlpha(clearAlpha);
    scene.background = bg;
    scene.fog = fog;
  }

  dispose() {
    this.rt.dispose();
    this.rtBlur.dispose();
    this.plane.geometry.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.hBlur.dispose();
    this.vBlur.dispose();
  }
}

export class Stage {
  constructor(renderer, scene, materials) {
    this.renderer = renderer;
    this.scene = scene;

    this.envRT = createStudioEnvironment(renderer);
    scene.environment = this.envRT.texture;

    this.background = new THREE.Color();
    scene.background = this.background;
    scene.fog = new THREE.Fog(this.background, 16, 46);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), materials.ground);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    scene.add(this.ground);

    this.key = new THREE.SpotLight('#fff6ee', 3, 0, 0.5, 1, 0);
    this.key.position.set(-4.6, 10.5, 6.2);
    this.key.target.position.set(0.2, 0, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.near = 6;
    this.key.shadow.camera.far = 24;
    this.key.shadow.bias = -0.0002;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 5;
    scene.add(this.key, this.key.target);

    this.rim = new THREE.DirectionalLight('#eef0ff', 1.4);
    this.rim.position.set(6, 5, -7.5);
    scene.add(this.rim);

    this.hemi = new THREE.HemisphereLight('#fff7ea', '#e0d4c2', 0.5);
    scene.add(this.hemi);

    // The light the fruit itself throws: a warm point source carried by the
    // pulp, dim while the skin still holds it in, fierce when it bursts.
    // No shadow of its own: on a floor this dark it would cost six extra
    // passes a frame and show almost nothing.
    this.glow = new THREE.PointLight('#ffb24d', 0, 0, 2);
    scene.add(this.glow);

    this.contact = new ContactShadow(renderer);
    scene.add(this.contact.group);
  }

  applyBackdrop(name, materials) {
    const b = BACKDROPS[name] || BACKDROPS.night;
    this.backdrop = b;
    this.key.angle = b.keyAngle ?? 0.5;
    this.background.set(b.bg);
    this.scene.fog.color.copy(this.background);
    materials.ground.color.set(b.floor);
    this.hemi.color.set(b.hemiSky);
    this.hemi.groundColor.set(b.floor);
    this.hemi.intensity = b.hemi;
    this.key.intensity = b.key;
    this.key.shadow.intensity = b.keyShadow;
    this.rim.intensity = b.rim;
    this.scene.environmentIntensity = b.env;
    this.contact.material.opacity = b.shadowOpacity;
    this.renderer.toneMappingExposure = b.exposure;
    this.glowScale = b.glow ?? 0.2;
    // Pulp lit from inside reads as the source of the light.
    for (const key of ['aril', 'jelly', 'juice', 'splat']) {
      materials[key].glow = materials[key].baseGlow * (1 + 2.5 * this.glowScale);
    }
    return b;
  }

  dispose() {
    this.envRT.dispose();
    this.ground.geometry.dispose();
    this.key.shadow.dispose();
    this.contact.dispose();
  }
}
