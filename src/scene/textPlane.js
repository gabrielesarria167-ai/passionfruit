import * as THREE from 'three';

// A line of type standing in the scene rather than on top of it, so the pieces
// thrown up by the burst pass in front of the words. Drawn into a canvas and
// mapped onto a plane; it fades in and is never dimmed by the fog or the
// tone mapping.
export class TextPlane {
  constructor({ text, font = 'Gloock, Georgia, serif', color = '#f6ece0', width = 5.6, ratio = 4 }) {
    this.text = text;
    this.font = font;
    this.color = color;

    this.canvas = document.createElement('canvas');
    this.canvas.width = 2048;
    this.canvas.height = Math.round(2048 / ratio);
    this._draw();

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.geometry = new THREE.PlaneGeometry(width, width / ratio);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;

    // The webfont usually arrives after the first paint: redraw when it does.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        this._draw();
        this.texture.needsUpdate = true;
      });
    }
  }

  _draw() {
    const { canvas } = this;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = this.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = Math.round(canvas.height * 0.52);
    for (let i = 0; i < 12; i++) {
      ctx.font = `400 ${size}px ${this.font}`;
      if (ctx.measureText(this.text).width <= canvas.width * 0.94) break;
      size = Math.round(size * 0.92);
    }
    ctx.fillText(this.text, canvas.width / 2, canvas.height * 0.54);
  }

  set opacity(v) {
    this.material.opacity = v;
    this.mesh.visible = v > 0.002;
  }

  get opacity() {
    return this.material.opacity;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
