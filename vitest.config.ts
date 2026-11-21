import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const CI = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CI;

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify('dev') },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test-setup.ts'],
    // The build server is several times slower than a laptop; one retry there absorbs a stalled runner, never a real failure that repeats.
    testTimeout: CI ? 60000 : 20000,
    retry: CI ? 1 : 0,
    include: ['src/**/*.test.{ts,tsx}'],
    maxWorkers: 4,
  },
});
