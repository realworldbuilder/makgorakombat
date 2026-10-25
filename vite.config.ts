import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The Mogshot engine (CASC reader, model parsers, skinning, renderer, worker) comes from the
// submodule in vendor/mogshot. MOGSHOT_SRC points at a checkout elsewhere while its engine is
// being worked on alongside the game: MOGSHOT_SRC=../wow-creator-suite/src pnpm dev
const mogshot = fileURLToPath(new URL(process.env.MOGSHOT_SRC ?? 'vendor/mogshot/src', import.meta.url));

export default defineConfig({
  // Served from https://realworldbuilder.github.io/makgorakombat/; VITE_BASE=/ for a site of its own
  // (pnpm run deploy:site, https://makgora.clawdioslave.com/).
  base: process.env.VITE_BASE ?? '/makgorakombat/',
  plugins: [preact()],
  worker: { format: 'es' },
  // Only the game's own page is scanned: the submodule's pages pull in things the game does not use.
  optimizeDeps: { entries: ['index.html'] },
  resolve: { alias: { '@mogshot': mogshot } },
  // Other checkouts of this repository under .worktrees must not reload the page: Vite watches the whole root.
  server: { fs: { allow: ['.', mogshot] }, watch: { ignored: ['**/.worktrees/**'] } },
  test: {
    include: ['test/**/*.test.ts'],
    alias: { '@mogshot': mogshot },
  },
});
