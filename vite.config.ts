import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.APP_VERSION ?? 'dev') },
  plugins: [react(), tailwindcss()],
});
