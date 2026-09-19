# passionfruit
Web portfolio inspired by the beauty of the passionfruit

## The drop

`index.html` is the opening scene: a procedural 3D passionfruit (three.js) falls through a dark studio, bursts on the floor and throws a plume of torn rind, golden pulp, seeds and juice into the air. A follow spot picks the fruit out on the way down; after the burst the pulp itself is the light source, so the black floor is lit by what is lying on it. Everything is generated in code, no model files.

```sh
npm install
npm run dev     # http://localhost:5173
npm run build   # dist/main.js for index.html, dist/passionfruit-scene.js as a classic <script>
```

URL options: `?backdrop=night|pith|lilac|aubergine`, `&variety=purple|golden`, `&impact=explode|split`, `&slowmo=0`, `&auto=1`. `impact=split` keeps the older ending, where the fruit tears in two and the halves roll onto their backs.

`src/scene/` holds the pieces: `fruitModel.js` (geometry), `shards.js` (tears the rind into pieces along warped Voronoi cells, each one a rigid body), `materials.js` (procedural shaders), `simulation.js` and `physics.js` (the fall and the burst), `juice.js` (spray, sacs and splats), `stage.js` (lights, backdrop, shadows) and `PassionfruitScene.js`, which ties them together. `dist/passionfruit-scene.js` exposes `window.PassionfruitScene.mount(canvas, options)` for pages that can't use modules.
