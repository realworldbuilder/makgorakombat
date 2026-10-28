import preact from '@preact/preset-vite';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

// The version on the roster: how many updates main has had, one per merged pull request, so it
// climbs by itself with every deploy and two people never pick the same number. A PR's Check builds
// its merge into main, so it shows the number the PR will ship as; a local checkout says so.
process.env.VITE_VERSION ??= (() => {
  try {
    const count = execSync('git rev-list --count --first-parent HEAD', { encoding: 'utf8' }).trim();
    return process.env.GITHUB_ACTIONS ? count : `${count} (local)`;
  } catch {
    return 'dev';
  }
})();

// The online version: a fingerprint of the code two machines must share to fight, the engine and the
// wire. Any change to them makes a new one, so a page left open from before a deploy is told to reload
// before the fight instead of parting from the other on a DESYNC; a change anywhere else leaves it be.
process.env.VITE_NET_VERSION ??= (() => {
  const hash = createHash('sha256');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))
      .sort();
  for (const file of [...walk('src/engine'), ...walk('src/game/net')]) {
    hash.update(file);
    hash.update(readFileSync(file));
  }
  return hash.digest('hex').slice(0, 10);
})();

export default defineConfig({
  // Served from https://realworldbuilder.github.io/makgorakombat/; VITE_BASE=/ for a site of its own
  // (a custom domain on GitHub Pages, or pnpm run deploy:site, https://makgora.clawdioslave.com/).
  // An empty VITE_BASE, as the Deploy workflow passes without a domain, is the default.
  base: process.env.VITE_BASE || '/makgorakombat/',
  plugins: [preact()],
  worker: { format: 'es' },
  // The pages: the game, the welcome page in front of it at /welcome/, the site's numbers at /stats/,
  // and the class guides at /guides/<class>/.
  build: { rollupOptions: { input: { main: 'index.html', welcome: 'welcome/index.html', stats: 'stats/index.html', warrior: 'guides/warrior/index.html', hunter: 'guides/hunter/index.html', play: 'guides/play/index.html' } } },
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
