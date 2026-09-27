import * as THREE from 'three';

// A line of type standing in the scene. Drawn into a canvas and mapped onto a
// plane; it fades in and is never dimmed by the fog or the tone mapping.
// With `overlay` it is drawn after everything else and ignores depth, so it
// sits in front of whatever passes through it.
// The text can be broken over several rows (see `setRows`), which keeps the
// glyphs large on a narrow screen.
export class TextPlane {
  constructor({ text, font = 'Gloock, Georgia, serif', color = '#f6ece0', width = 5.6, ratio = 4, overlay = false }) {
    this.text = text;
    this.font = font;
    this.color = color;
    this.width = width;
    this.ratio = ratio;
    this.rows = [text];

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
      depthTest: !overlay,
      toneMapped: false,
      fog: false,
    });
    this.geometry = new THREE.PlaneGeometry(width, width / ratio);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    if (overlay) this.mesh.renderOrder = 100;

    // The webfont usually arrives after the first paint: redraw when it does.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        this._draw();
        this.texture.needsUpdate = true;
      });
    }
  }

  // Breaks the text over the given rows (joined by spaces they must spell the
  // text). The plane keeps its width and grows taller to fit them.
  setRows(rows) {
    if (rows.join('\n') === this.rows.join('\n')) return;
    this.rows = rows;
    const ratio = this.ratio / rows.length;
    const height = Math.round(2048 / ratio);
    // A canvas texture cannot change size once uploaded: start a fresh one.
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2048;
    this.canvas.height = height;
    this._draw();
    const old = this.texture;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = old.colorSpace;
    this.texture.anisotropy = old.anisotropy;
    this.texture.minFilter = old.minFilter;
    this.material.map = this.texture;
    this.material.needsUpdate = true;
    old.dispose();
    this.geometry.dispose();
    this.geometry = new THREE.PlaneGeometry(this.width, this.width / ratio);
    this.mesh.geometry = this.geometry;
  }

  _draw() {
    const { canvas, rows } = this;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = this.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rowH = canvas.height / rows.length;
    let size = Math.round(rowH * 0.52);
    for (let i = 0; i < 16; i++) {
      ctx.font = `400 ${size}px ${this.font}`;
      if (Math.max(...rows.map((r) => ctx.measureText(r).width)) <= canvas.width * 0.94) break;
      size = Math.round(size * 0.92);
    }
    rows.forEach((r, i) => ctx.fillText(r, canvas.width / 2, rowH * (i + 0.54)));
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
