import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEvent, type Session } from '../src/core/model';
import { claudeContextTokens, claudeLimits, codexLimits } from '../src/providers/usage';

test('Codex windows keep the reported numbers and convert reset seconds', () => {
  assert.deepEqual(
    codexLimits({
      primary: { usedPercent: 31, windowDurationMins: 300, resetsAt: 1_000 },
      secondary: { usedPercent: 12, windowDurationMins: 10_080, resetsAt: null },
    }),
    [
      { id: 'primary', label: '5-hour', usedPercent: 31, resetsAt: 1_000_000 },
      { id: 'secondary', label: 'Weekly', usedPercent: 12 },
    ],
  );
  assert.deepEqual(codexLimits({ primary: null, secondary: null }), []);
  assert.deepEqual(codexLimits(undefined), []);
});
test('Claude windows ignore null meters, as API key sessions report', () => {
  assert.deepEqual(
    claudeLimits({
      five_hour: { utilization: 40, resets_at: '2026-11-04T10:00:00Z' },
      seven_day: { utilization: null, resets_at: null },
      seven_day_opus: null,
    }),
    [
      {
        id: 'five_hour',
        label: '5-hour',
        usedPercent: 40,
        resetsAt: Date.parse('2026-11-04T10:00:00Z'),
      },
    ],
  );
  assert.deepEqual(claudeLimits(null), []);
});
test('Claude context counts cached input, and unknown usage stays unknown', () => {
  assert.equal(
    claudeContextTokens({
      input_tokens: 10,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 5,
      output_tokens: 20,
    }),
    135,
  );
  assert.equal(claudeContextTokens({}), undefined);
});
test('a sparse update keeps what it does not mention', () => {
  const session = { status: 'running', messages: [] } as unknown as Session;
  applyEvent(session, {
    type: 'usage',
    context: { used: 10, max: 100 },
    limits: [
      { id: 'primary', label: '5-hour', usedPercent: 1 },
      { id: 'secondary', label: 'Weekly', usedPercent: 2 },
    ],
  });
  applyEvent(session, {
    type: 'usage',
    limits: [{ id: 'primary', label: '5-hour', usedPercent: 9 }],
  });
  assert.deepEqual(session.usage?.context, { used: 10, max: 100 });
  assert.deepEqual(
    session.usage?.limits?.map((item) => item.usedPercent),
    [9, 2],
  );
});
