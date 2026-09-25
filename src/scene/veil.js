import * as THREE from 'three';

// A plain fade through one colour, drawn straight in clip space over
// everything: with reduced motion the set dissolves into the night through it,
// and the scene is swapped underneath.
export class Veil {
  constructor(color) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uAmount: { value: 0 },
        uColor: { value: new THREE.Color(color) },
      },
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAmount;
        uniform vec3 uColor;
        void main() {
          gl_FragColor = vec4(uColor, uAmount);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
    this.mesh.visible = false;
  }

  set amount(v) {
    this.material.uniforms.uAmount.value = v;
    this.mesh.visible = v > 0.001;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
