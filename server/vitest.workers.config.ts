import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => ({
  plugins: [cloudflareTest({
    remoteBindings: false,
    miniflare: {
      compatibilityDate: '2026-02-24',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
      bindings: { TEST_MIGRATIONS: await readD1Migrations(fileURLToPath(new URL('../db/migrations/', import.meta.url))) },
    },
  })],
  test: {
    include: ['server/workers.integration.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
}));
