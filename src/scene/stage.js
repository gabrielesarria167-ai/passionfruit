import * as THREE from 'three';

// Seamless studio sweeps. `bg` is both the clear colour and the fog colour so
// the floor dissolves into the backdrop without a horizon line.
// Everything the fruit's own lights touch sits on this layer; the floor does not.
export const FRUIT_LAYER = 1;

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

    // The follow spot lights the fruit alone (layer 1): pointed at a floor it
    // would paint a pool of light across the dark.
    this.key = new THREE.SpotLight('#fff6ee', 3, 0, 0.5, 1, 0);
    this.key.position.set(-4.6, 10.5, 6.2);
    this.key.target.position.set(0.2, 0, 0);
    this.key.layers.set(FRUIT_LAYER);
    scene.add(this.key, this.key.target);

    this.rim = new THREE.DirectionalLight('#eef0ff', 1.4);
    this.rim.position.set(6, 5, -7.5);
    this.rim.layers.set(FRUIT_LAYER);
    scene.add(this.rim);

    this.hemi = new THREE.HemisphereLight('#fff7ea', '#e0d4c2', 0.5);
    scene.add(this.hemi);

    // The light the fruit itself throws: a warm point source carried by the
    // pulp, dim while the skin still holds it in, fierce when it bursts.
    this.glow = new THREE.PointLight('#ffb24d', 0, 0, 2);
    scene.add(this.glow);
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
    this.rim.intensity = b.rim;
    this.scene.environmentIntensity = b.env;
    this.renderer.toneMappingExposure = b.exposure;
    this.glowScale = b.glow ?? 0.2;
    // Pulp lit from inside reads as the source of the light.
    for (const key of ['aril', 'jelly', 'juice', 'splat']) {
      materials[key].glow = materials[key].baseGlow * (1 + 2.5 * this.glowScale);
    }
    // Pulp and juice are solid: over anything they show the set behind them.
    materials.aril.behind = this.background;
    materials.juice.behind = this.background;
    return b;
  }

  dispose() {
    this.envRT.dispose();
    this.ground.geometry.dispose();
  }
}
