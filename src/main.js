import { mount } from './scene/PassionfruitScene.js';

const canvas = document.getElementById('scene');
const params = new URLSearchParams(location.search);
const scene = mount(canvas, {
  backdrop: params.get('backdrop') || 'night',
  variety: params.get('variety') || 'purple',
  impact: params.get('impact') || 'explode',
  slowMotion: params.get('slowmo') !== '0',
  autoReplay: params.get('auto') === '1',
});

// ?seek=<seconds> renders a single still of that moment (handy for screenshots).
const seek = params.get('seek');
if (seek !== null) {
  scene.seek(parseFloat(seek)).then(() => {
    document.title = 'seek-done';
  });
}

document.getElementById('replay').addEventListener('click', () => scene.replay());
window.passionfruit = scene;
