import tailwindcss from '@tailwindcss/vite';
import { nitro } from 'nitro/vite';
import vinext from 'vinext';
import { defineConfig } from 'vite';

// Development uses vinext's own dev server (React Server Components with
// HMR). Production builds add Nitro, which emits a Node server locally and
// the Vercel output when the build runs on Vercel. Server secrets come from
// `.env` locally and from the project's environment variables in production
// (see docs/DEPLOYMENT.md).
export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    vinext(),
    ...(command === 'build' ? [nitro()] : []),
  ],
}));
