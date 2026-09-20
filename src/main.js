import { mount } from './scene/PassionfruitScene.js';

const canvas = document.getElementById('scene');
const params = new URLSearchParams(location.search);
// This line sits under the falling fruit and fades out as it gives way; the
// line that answers it stands inside the scene, behind the burst.
const before = document.querySelector('[data-line="before"]');

const scene = mount(canvas, {
  onPhase: (phase) => before.classList.toggle('is-on', phase !== 'open' && phase !== 'rest'),
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
