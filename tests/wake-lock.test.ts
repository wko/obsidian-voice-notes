import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecordingWakeLock } from '../src/wake-lock';

class FakeSentinel extends EventTarget {
  releases = 0;
  async release() { this.releases++; this.dispatchEvent(new Event('release')); }
}

class FakeDocument extends EventTarget {
  hidden = false;
}

test('screen stays awake only while recording and is reacquired after visibility returns', async () => {
  const sentinels: FakeSentinel[] = [];
  const documentRef = new FakeDocument();
  const lock = new RecordingWakeLock({ wakeLock: { async request() {
    const sentinel = new FakeSentinel(); sentinels.push(sentinel); return sentinel;
  } } }, documentRef);

  assert.equal(await lock.start(), true);
  assert.equal(sentinels.length, 1);
  documentRef.hidden = true;
  await sentinels[0].release();
  documentRef.dispatchEvent(new Event('visibilitychange'));
  documentRef.hidden = false;
  documentRef.dispatchEvent(new Event('visibilitychange'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sentinels.length, 2);

  await lock.stop();
  assert.equal(sentinels[1].releases, 1);
  documentRef.dispatchEvent(new Event('visibilitychange'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sentinels.length, 2);
});

test('unsupported or rejected wake lock never blocks recording', async () => {
  const documentRef = new FakeDocument();
  assert.equal(await new RecordingWakeLock({}, documentRef).start(), false);
  assert.equal(await new RecordingWakeLock({ wakeLock: { async request() { throw new Error('low battery'); } } }, documentRef).start(), false);
});
