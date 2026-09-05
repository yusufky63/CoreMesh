// `npm start` runs the production bundle under wrangler dev, which reads
// `.dev.vars` next to its config file. Mirror the project-level file there so
// the production build sees the same local secrets as `npm run dev`.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const source = '.dev.vars';
const targetDir = 'dist/server';
if (existsSync(source)) {
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, `${targetDir}/.dev.vars`);
  console.error('prepare-start: local secrets mirrored into dist/server/.dev.vars');
} else {
  console.error('prepare-start: no .dev.vars found; hosted keys and the relay token stay unset');
}
