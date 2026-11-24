import { defineConfig } from 'void/config';

/** The plugin is a static Vite build: Void only hosts `dist`, so there is no server code. */
export default defineConfig({
  inference: { appType: 'spa', build: 'npm run build', outputDir: 'dist' },
  routing: {
    headers: {
      // A new navigation picks up the current deployment's asset URLs; the fingerprinted assets keep their normal cache.
      '/': ['Cache-Control: no-cache'],
      // The plugin iframe has a null origin.
      '/assets/*': ['Access-Control-Allow-Origin: *'],
    },
  },
});
