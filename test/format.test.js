import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usd, int, truncate, clock, summarizeEvent, formatEvent, table } from '../src/lib/format.js';

test('usd shows sub-cent amounts with five decimals', () => {
  assert.equal(usd(5), '$5.00');
  assert.equal(usd(0), '$0.00');
  assert.equal(usd(0.00042), '$0.00042');
  assert.equal(usd(undefined), '$0.00');
});

test('int, truncate and clock', () => {
  assert.equal(int(1234567), '1,234,567');
  assert.equal(truncate('a  b\n c', 10), 'a b c');
  assert.equal(truncate('abcdefghij', 5), 'abcd…');
  assert.match(clock('2026-09-24T08:05:09Z'), /^\d\d:05:09$/);
});

test('summarizeEvent per type', () => {
  const cost = { type: 'cost.recorded', payload: { usd: 0.01, estimated: true, model: 'a/b', promptTokens: 1200, completionTokens: 30 } };
  assert.equal(summarizeEvent(cost), '$0.01~  a/b  1,200 in / 30 out');
  assert.equal(summarizeEvent({ type: 'llm.failed', payload: { model: 'a/b', reason: 'empty', error: 'x' } }), 'a/b: [empty] x');
  assert.equal(summarizeEvent({ type: 'subject.posted', payload: { title: 'Soup', url: 'u' } }), 'Soup');
  assert.equal(summarizeEvent({ type: 'chatter.posted', payload: { text: 'darling' } }), 'darling');
  assert.equal(summarizeEvent({ type: 'shift.started', payload: {} }), '');
  assert.equal(summarizeEvent({ type: 'series.started', payload: { n: 12 } }), '{"n":12}');
});

test('formatEvent lines up columns', () => {
  const line = formatEvent({ ts: '2026-09-24T08:00:00Z', type: 'shift.started', actor: 'orchestrator', payload: {} });
  assert.match(line, /^\d\d:00:00 {2}shift\.started {6}orchestrator$/);
});

test('table aligns text left and numbers right', () => {
  assert.equal(table([['a', '$1.00'], ['bbb', '$10.00']], { indent: '' }), 'a     $1.00\nbbb  $10.00');
  assert.equal(table([]), '');
});
