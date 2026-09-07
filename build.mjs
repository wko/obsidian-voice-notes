import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
const destination = new URL('../Voice Append Lab/.obsidian/plugins/voice-append/', import.meta.url);
const release = process.argv.includes('--release');
const deploy = { name: 'lab-install', setup(build) { build.onEnd(async result => {
  if (result.errors.length) return;
  if (release) { for (const file of ['manifest.json', 'styles.css']) await copyFile(new URL(file, import.meta.url), new URL(`dist/${file}`, import.meta.url)); return; }
  await mkdir(destination, { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(new URL(file, import.meta.url), new URL(file, destination));
  console.log('Voice Append built and installed in Voice Append Lab. Reload the plugin to use changes.');
}); }};
const context = await esbuild.context({ entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', target: 'es2020', platform: 'browser', outfile: release ? 'dist/main.js' : 'main.js', sourcemap: release ? false : 'inline', define: { VOICE_APPEND_LAB: String(!release) }, external: ['obsidian', 'electron', '@codemirror/state', '@codemirror/view'], plugins: [deploy] });
if (process.argv.includes('--watch')) await context.watch();
else { await context.rebuild(); await context.dispose(); }
