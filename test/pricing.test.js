import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPricing, toModelInfo, CHARS_PER_TOKEN } from '../src/pricing.js';
import { fakeFetch } from './helpers.js';

test('toModelInfo parses string prices and vision support', () => {
  const info = toModelInfo({ id: 'a/b', pricing: { prompt: '0.000003', completion: '0.000015', image: 'x' }, architecture: { input_modalities: ['text', 'image'] }, context_length: 1000 });
  assert.deepEqual(info, { id: 'a/b', prompt: 0.000003, completion: 0.000015, image: 0, request: 0, vision: true, contextLength: 1000 });
});

test('estimate is an upper bound using max tokens; costOf uses real counts', async () => {
  const pricing = createPricing({ fetch: fakeFetch() });
  const est = await pricing.estimate('test/vision', { promptChars: 350, maxTokens: 1000, images: 2 });
  assert.equal(est.toFixed(6), (Math.ceil(350 / CHARS_PER_TOKEN) * 0.000002 + 1000 * 0.000004 + 2 * 0.001).toFixed(6));
  assert.equal((await pricing.costOf('test/text', { promptTokens: 10, completionTokens: 10 })).toFixed(8), '0.00003000');
  assert.equal((await pricing.get('test/vision')).vision, true);
});

test('unknown models estimate 0 and have no cost', async () => {
  const pricing = createPricing({ fetch: fakeFetch() });
  assert.equal(await pricing.estimate('nope/x', { promptChars: 10, maxTokens: 10 }), 0);
  assert.equal(await pricing.costOf('nope/x', {}), null);
});

test('the model list is fetched once, and failures degrade to no pricing', async () => {
  let calls = 0;
  const pricing = createPricing({ fetch: async () => (calls++, Response.json({ data: [] })) });
  await Promise.all([pricing.get('a'), pricing.get('b'), pricing.estimate('c', { promptChars: 1, maxTokens: 1 })]);
  assert.equal(calls, 1);

  const offline = createPricing({ fetch: async () => { throw new Error('offline'); } });
  assert.equal(await offline.get('a'), null);
  const erroring = createPricing({ fetch: async () => new Response('nope', { status: 500 }) });
  assert.equal(await erroring.get('a'), null);
});
