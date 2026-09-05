import tailwindcss from '@tailwindcss/vite';
import { nitro } from 'nitro/vite';
import vinext from 'vinext';
import { defineConfig } from 'vite';

// Deployment target: Nitro. Locally it serves a Node server; on Vercel the
// preset is detected from the build environment and emits `.vercel/output`.
// Server secrets come from `.env` locally and from the project's environment
// variables in production (see docs/DEPLOYMENT.md).
export default defineConfig({
  plugins: [tailwindcss(), vinext(), nitro()],
});
