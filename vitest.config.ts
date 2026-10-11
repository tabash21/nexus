import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['development'] },
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/**/*.integration.test.ts'], testTimeout: 15000 },
});

