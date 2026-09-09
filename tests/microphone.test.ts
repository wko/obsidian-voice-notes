import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
test('native macOS first-use permission, denied recovery, and mobile isolation', async () => {
  const state = globalThis as any;
  const platform = { isDesktopApp: true, isMacOS: true, isWin: false, isIosApp: false };
  state.__voiceTestPlatform = platform;
  let requests = 0; let permissionRequests = 0; let status = 'not-determined'; let allowed = false;
  state.__voiceTestElectron = { remote: { systemPreferences: { getMediaAccessStatus() { return status; }, async askForMediaAccess() { permissionRequests++; return allowed; } } } };
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); const originalRecorder = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder'); const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { require: () => state.__voiceTestElectron } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { async getUserMedia() { requests++; return 'fake-stream'; } } } });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: class {} });
  try {
    const result = await build({ entryPoints: ['src/microphone.ts'], bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'platform-mocks', setup(build) {
      build.onResolve({ filter: /^(obsidian|electron)$/ }, args => ({ path: args.path, namespace: 'test' }));
      build.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'obsidian' ? 'export const Platform = globalThis.__voiceTestPlatform;' : 'module.exports = globalThis.__voiceTestElectron;' }));
    } }] });
    const microphone = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
    await assert.rejects(microphone.requestMicrophone(), { name: 'NotAllowedError' }); assert.equal(requests, 0); assert.equal(permissionRequests, 1);
    assert.match(microphone.microphoneHelp(new DOMException('denied', 'NotAllowedError')).help, /macOS/);
    allowed = true; assert.equal(await microphone.requestMicrophone(), 'fake-stream'); assert.equal(requests, 1);
    status = 'granted'; await microphone.requestMicrophone(); assert.equal(permissionRequests, 2);
    platform.isDesktopApp = false; platform.isMacOS = false; platform.isIosApp = true;
    await microphone.requestMicrophone(); assert.equal(permissionRequests, 2); assert.equal(requests, 3);
    assert.match(microphone.microphoneHelp(new DOMException('denied', 'NotAllowedError')).help, /iPhone/);
    assert.match(microphone.microphoneHelp(new DOMException('not found', 'NotFoundError')).message, /Mikrofon gefunden/);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete state.navigator;
    if (originalRecorder) Object.defineProperty(globalThis, 'MediaRecorder', originalRecorder); else delete state.MediaRecorder;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete state.window;
    delete state.__voiceTestPlatform; delete state.__voiceTestElectron;
  }
});
