# GitHub Pages build

Run `npm run build:pages`. This writes the static site to `docs/` with the
`/threejs-wgsl/` base path and a `.nojekyll` file. Commit the generated `docs/`
directory, then choose **Settings → Pages → Deploy from a branch → main → /docs**.

The optimized GPU culling scene is the default. Use `?scene=noCopy` for the
original benchmark. The new scene accepts `radius=10|20|50|100|250`,
`cull=frustum` for frustum-only culling, and `minPixelRadius=0.5` for the
screen-size cutoff. The UI samples the post-cull count asynchronously from a
reused 4-byte staging buffer; rendering never waits for this readback.

The existing `npm run build` includes project-wide TypeScript checking and
currently reports errors in unrelated source files. `build:pages` runs Vite
directly so the static site can be generated independently.
