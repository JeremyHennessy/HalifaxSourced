import assert from 'node:assert/strict';
import vm from 'node:vm';
import { waitForDetailAnchorSettlement } from './lib/detail-anchor-browser-checks.mjs';

async function simulate(frames, { timeoutMs = 500, missing = false, frameMs = 20 } = {}) {
  let now = 0, nextId = 0, current = frames[0];
  const rafs = new Map(), timers = new Map();
  const target = {
    getBoundingClientRect: () => ({ top: (current.documentTop ?? 1179.125) - current.y }),
    querySelector: () => ({ getBoundingClientRect: () => ({ top: target.getBoundingClientRect().top + 20, bottom: target.getBoundingClientRect().top + 48 }) })
  };
  const tabs = { scrollLeft: 0, getBoundingClientRect: () => ({ top: 131, bottom: 171, height: 40 }) };
  const header = { getBoundingClientRect: () => ({ bottom: 131 }) };
  const context = vm.createContext({
    document: { getElementById: id => id === 'siteHeader' ? header : missing ? null : target, querySelector: selector => selector === '.detail-tabs' ? tabs : null, documentElement: { scrollHeight: 4000 }, activeElement: { id: 'detailMenu' } },
    getComputedStyle: () => ({ top: '131px' }), innerWidth: 500, innerHeight: 1000,
    location: { hash: '#restaurant/fixture' }, history: { length: 5 }, scrollX: 0,
    get scrollY() { return current.y; }, performance: { now: () => now },
    requestAnimationFrame: callback => { const id = ++nextId; rafs.set(id, callback); return id; },
    cancelAnimationFrame: id => rafs.delete(id),
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  const resultPromise = vm.runInContext(`(${waitForDetailAnchorSettlement.toString()})({id:'detailMenu',timeoutMs:${timeoutMs}})`, context);
  for (let index = 0; (rafs.size || timers.size) && now <= timeoutMs + frameMs; index++) {
    now += frameMs;
    current = frames[Math.min(index, frames.length - 1)];
    const callbacks = [...rafs.values()]; rafs.clear();
    for (const callback of callbacks) callback(now);
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  }
  const result = await resultPromise;
  assert.equal(rafs.size, 0, 'Settlement must leave no pending RAF callbacks');
  assert.equal(timers.size, 0, 'Settlement must clear its bounded deadline');
  return result;
}

const tail = await simulate([1007, 1004, 1002, 1001, 1000].map(y => ({ y })));
assert(tail.settled);
assert.equal(tail.sample.destination, 1000.125);
assert.equal(tail.sample.scrollY, 1000);
assert(tail.trace.some(frame => frame.scrollY === 1002 && frame.nearTarget), 'Exercise the old one-frame false settle');
assert(tail.quietMs >= 100 && tail.stableIntervals >= 3);
assert(tail.elapsedMs >= 200, 'Wait through the moving tail and then the full quiet window');
const repeat = await simulate([{ y: 1000 }]);
assert(repeat.settled && repeat.quietMs >= 100 && repeat.stableIntervals >= 3, 'No-op repeat still proves stable frames');
assert(Math.abs(repeat.sample.scrollY - tail.sample.scrollY) < 2, 'Keep the original strict repeat-drift assertion');
const layout = await simulate([{ y: 1000 }, { y: 1000 }, { y: 1000, documentTop: 1179.625 }]);
assert(layout.settled && layout.elapsedMs >= 160, 'Stable scroll alone is insufficient after target layout moves');
const clamped = await simulate([{ y: 3000, documentTop: 3300 }]);
assert(clamped.settled && clamped.sample.destination === 3000, 'Keep existing end-of-document clamping');
const slowFrames = await simulate([{ y: 1000 }], { frameMs: 100 });
assert(slowFrames.settled && slowFrames.stableIntervals >= 3 && slowFrames.elapsedMs >= 400, 'Elapsed time cannot replace three RAF intervals');
const deadline = await simulate([{ y: 900 }], { timeoutMs: 800 });
assert.equal(deadline.settled, false);
assert.equal(deadline.reason, 'deadline');
assert.equal(deadline.trace.length, 32, 'Retain a bounded recent trace on failure');
assert.equal(deadline.sample.scrollY, 900);
const absent = await simulate([{ y: 1000 }], { missing: true });
assert.equal(absent.settled, false);
assert.match(absent.reason, /missing/);
console.log('Detail anchor settlement passed: fractional moving tail, repeated no-op, layout shift, clamping, three RAF intervals plus 100ms quiet, bounded diagnostics and callback cleanup.');
