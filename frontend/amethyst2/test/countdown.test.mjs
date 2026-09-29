import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countdown } from '../src/lib/countdown.js';

test('countdown uses the exact deadline instant and includes days', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  assert.deepEqual(countdown('2026-10-01T13:02:03Z', now), { overdue:false, days:2, hours:1, minutes:2, seconds:3 });
  assert.deepEqual(countdown('2026-10-01T08:02:03-05:00', now), countdown('2026-10-01T13:02:03Z', now));
  assert.equal(countdown('2026-10-01T13:02:03Z', now + 1000).seconds, 2);
});
test('deadline boundary, overdue, missing and invalid dates', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  assert.equal(countdown('2026-09-29T12:00:00.001Z', now).seconds, 1);
  assert.deepEqual(countdown('2026-09-29T12:00:00Z', now), { overdue:false, days:0, hours:0, minutes:0, seconds:0 });
  assert.deepEqual(countdown('2026-09-28T11:59:59Z', now), { overdue:true, days:1, hours:0, minutes:0, seconds:1 });
  assert.equal(countdown(null, now), null);
  assert.equal(countdown('invalid', now), null);
});
