# Canvas source

The Design canvas at https://claude.ai/artifact/Gy19ordHa799obGtm353A2 serves
these two files from its own `project/` folder; this is the copy of record.

- `Main.dc.html` — the artboard: the page markup plus the logic class that
  mounts the scene into its `<canvas>`.
- `canvas.json` — the canvas index: the artboard's frame and options.

The scene itself is not in here. `npm run build` writes
`dist/passionfruit-scene.js`, which is uploaded to the artifact as an asset and
loaded by the url the upload returns (the `/_blob/...` path in `Main.dc.html`).
Rebuild, upload the new bundle, repoint that url, then publish both files back
to the canvas.
