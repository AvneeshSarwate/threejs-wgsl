import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const vite = new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname;
const result = spawnSync(process.execPath,
  [vite, 'build', '--outDir', 'docs', '--base', '/threejs-wgsl/', '--sourcemap', 'false'],
  { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
writeFileSync(new URL('../docs/.nojekyll', import.meta.url), '');
