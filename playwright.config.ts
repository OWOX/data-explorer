import { defineConfig } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> };
// Optional: PW_CHROMIUM points at a preinstalled Chromium binary (we never run `playwright install`).
export default defineConfig({
  testDir: 'e2e',
  workers: 4,
  use: { launchOptions: { executablePath: process.env.PW_CHROMIUM }, baseURL: 'http://localhost:4173', trace: 'off', viewport: { width: 1440, height: 900 } },
  webServer: { command: 'npx vite build && npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: true, timeout: 120_000 },
});
