import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// The tests run inside the Workers runtime, on the Worker and the Room as wrangler.jsonc declares them.
// A Discord bot and server that are not real, so the room offers voice; voice.test.ts stands in for Discord. A feedback token, so it can be read back.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' }, miniflare: { bindings: { DISCORD_TOKEN: 'test-token', DISCORD_GUILD: '1000000000000000001', FEEDBACK_TOKEN: 'test-feedback-token' } } })],
});
