import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const development = process.argv.includes('--watch');
const destination = process.env.OBSIDIAN_PLUGIN_DIR;
const deploy = { name: 'install-build', setup(build) { build.onEnd(async result => {
  if (result.errors.length) return;
  if (!development) {
    await mkdir(new URL('dist/', import.meta.url), { recursive: true });
    for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(new URL(file, import.meta.url), new URL(`dist/${file}`, import.meta.url));
  }
  if (!destination) return;
  await mkdir(destination, { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(new URL(file, import.meta.url), join(destination, file));
  console.log(`Voice Append built and installed in ${destination}. Reload the plugin to use the changes.`);
}); }};
const context = await esbuild.context({ entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', target: 'es2020', platform: 'browser', outfile: 'main.js', sourcemap: development ? 'inline' : false, loader: { '.wav': 'base64' }, define: { VOICE_APPEND_LAB: String(development) }, external: ['obsidian', 'electron', '@codemirror/state', '@codemirror/view'], plugins: [deploy] });
if (process.argv.includes('--watch')) await context.watch();
else { await context.rebuild(); await context.dispose(); }
