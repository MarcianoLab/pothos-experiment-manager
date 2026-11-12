import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionTimingMetadata } from '../app/lib/sessionTiming.ts';
const metadata = (start, end) => Object.fromEntries(sessionTimingMetadata(start, new Date(end)).map(row => [row.field, row.value]));

test('start and save have separate Israel dates across midnight', () => {
  assert.deepEqual(metadata('2026-10-28T21:59:58Z', '2026-10-28T22:03:04Z'), {
    session_start_date: '2026-10-28', session_start_time: '23:59:58',
    session_end_date: '2026-10-29', session_end_time: '00:03:04',
    session_time_zone: 'Asia/Jerusalem',
  });
});

test('each timestamp uses the Israel offset applicable on its own date', () => {
  const rows = metadata('2026-10-24T20:30:00Z', '2026-10-25T21:30:00Z');
  assert.equal(rows.session_start_time, '23:30:00');
  assert.equal(rows.session_end_time, '23:30:00');
  assert.equal(rows.session_start_date, '2026-10-24');
  assert.equal(rows.session_end_date, '2026-10-25');
});

test('a later save updates the end while preserving the original start', () => {
  const first = metadata('2026-10-28T10:00:00Z', '2026-10-28T11:00:00Z');
  const later = metadata('2026-10-28T10:00:00Z', '2026-10-29T12:15:00Z');
  assert.equal(later.session_start_date, first.session_start_date);
  assert.equal(later.session_start_time, first.session_start_time);
  assert.equal(later.session_end_date, '2026-10-29');
  assert.equal(later.session_end_time, '14:15:00');
});
