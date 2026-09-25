# passionfruit
Web portfolio inspired by the beauty of the passionfruit

## The drop

`index.html` is the opening scene: a procedural 3D passionfruit (three.js) falls through a dark studio, bursts on the floor and throws a plume of torn rind, golden pulp, seeds and juice into the air. A follow spot picks the fruit out on the way down; after the burst the pulp itself is the light source, so the black floor is lit by what is lying on it. One line waits under the fall, and the line that answers it stands inside the scene, so the pieces thrown up cross in front of the words while the camera closes in on them. Once the slow motion has worn off and nine pieces in ten have come down, time all but stops and the camera sinks and tips its gaze down onto the scatter, so the words rise away out of the frame. Night comes up from below and the floor gives way to it: every drop of juice and piece of pulp lights up and falls into a real star, most of the rind goes the same way and a few pieces come back as comets shooting across the new sky, down and to the right, the rest of the sky comes up brightest first, and the camera settles on Orion. The fruit is generated in code, no model files; the sky is the Yale Bright Star Catalogue.

```sh
npm install
npm run dev     # http://localhost:5173
npm run build   # dist/main.js for index.html, dist/passionfruit-scene.js as a classic <script>
```

URL options: `?backdrop=night|pith|lilac|aubergine`, `&variety=purple|golden`, `&impact=explode|split`, `&transition=stars|none`, `&slowmo=0`, `&auto=1`. `transition=none` ends on the line, as before. `impact=split` keeps the older ending, where the fruit tears in two and the halves roll onto their backs.

`src/scene/` holds the pieces: `fruitModel.js` (geometry), `shards.js` (tears the rind into pieces along warped Voronoi cells, each one a rigid body), `materials.js` (procedural shaders), `simulation.js` and `physics.js` (the fall and the burst), `juice.js` (spray, sacs and splats), `stage.js` (lights, backdrop, shadows), `stars.js` (the sky), `comets.js` (what the rind becomes) and `veil.js` (the fade used when motion is reduced), and `PassionfruitScene.js`, which ties them together. `dist/passionfruit-scene.js` exposes `window.PassionfruitScene.mount(canvas, options)` for pages that can't use modules.

## The sky

`src/scene/starCatalog.js` is the Yale Bright Star Catalogue, 5th revised edition (Hoffleit & Warren 1991, public domain): 9,096 stars with their J2000 positions, V magnitudes and B-V colour indices. Brightness follows the magnitude and colour follows the star's temperature (from B-V) as a blackbody. `node scripts/build-stars.mjs` regenerates it from the Harvard-Smithsonian copy of the catalogue; the build itself needs no network.
