import test from 'node:test';
import assert from 'node:assert/strict';
import { createTripleClickCounter } from '../src/lib/tripleClick.js';

test('only the third rapid click triggers, and another triple triggers again', () => {
  const counter = createTripleClickCounter();
  assert.deepEqual([1000, 1100, 1200, 1300, 1400, 1500].map(at => counter.click(at)), [false, false, true, false, false, true]);
});
test('clicks on separate existing or new task instances cannot combine', () => {
  const existing = createTripleClickCounter(), newlyCreated = createTripleClickCounter();
  assert.equal(existing.click(1000), false);
  assert.equal(newlyCreated.click(1100), false);
  assert.equal(existing.click(1200), false);
  assert.equal(newlyCreated.click(1300), false);
  assert.equal(existing.click(1400), true);
  assert.equal(newlyCreated.click(1500), true);
});
test('slow clicks and interaction with controls reset the sequence', () => {
  const counter = createTripleClickCounter();
  assert.equal(counter.click(1000), false);
  assert.equal(counter.click(1600), false);
  assert.equal(counter.click(1700), false);
  counter.reset();
  assert.equal(counter.click(1800), false);
  assert.equal(counter.click(1900), false);
  assert.equal(counter.click(2000), true);
});
