import preact from '@preact/preset-vite';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The Mogshot engine (CASC reader, model parsers, skinning, renderer, worker) comes from the
// submodule in vendor/mogshot. MOGSHOT_SRC points at a checkout elsewhere while its engine is
// being worked on alongside the game: MOGSHOT_SRC=../wow-creator-suite/src pnpm dev
const mogshot = fileURLToPath(new URL(process.env.MOGSHOT_SRC ?? 'vendor/mogshot/src', import.meta.url));

// The commit a build was made from, for bug reports sent from the game: the Action's own, or this checkout's.
process.env.VITE_BUILD ??= (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return `${execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()} (local)`;
  } catch {
    return 'local';
  }
})();

export default defineConfig({
  // Served from https://realworldbuilder.github.io/makgorakombat/
  base: '/makgorakombat/',
  plugins: [preact()],
  worker: { format: 'es' },
  // Only the game's own page is scanned: the submodule's pages pull in things the game does not use.
  optimizeDeps: { entries: ['index.html'] },
  resolve: { alias: { '@mogshot': mogshot } },
  server: { fs: { allow: ['.', mogshot] } },
  test: {
    include: ['test/**/*.test.ts'],
    alias: { '@mogshot': mogshot },
  },
});
