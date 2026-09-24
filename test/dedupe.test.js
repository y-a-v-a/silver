import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, normalizeTitle, keysOf, subjectKeys, dedupe } from '../src/lib/dedupe.js';

test('normalizeUrl drops tracking, fragments, www, trailing slashes and http', () => {
  assert.equal(
    normalizeUrl('http://www.BBC.co.uk/news/articles/abc/?at_medium=RSS&at_campaign=rss&utm_source=x#top'),
    'https://bbc.co.uk/news/articles/abc',
  );
  assert.equal(normalizeUrl('https://a.com/p?b=2&a=1&fbclid=z'), 'https://a.com/p?a=1&b=2');
  assert.equal(normalizeUrl('https://a.com/'), 'https://a.com');
  assert.equal(normalizeUrl('https://news.ycombinator.com/item?id=7'), 'https://news.ycombinator.com/item?id=7');
});

test('normalizeUrl rejects junk and non-web schemes', () => {
  for (const bad of [null, undefined, '', 'not a url', 'mailto:a@b.c', 'ftp://x.org/f']) assert.equal(normalizeUrl(bad), null);
});

test('normalizeTitle folds case, accents and punctuation; ignores very short titles', () => {
  assert.equal(normalizeTitle('Café Society: “The Soup” Returns!'), 'cafe society the soup returns');
  assert.equal(normalizeTitle('Court Blocks Trump’s Ban'), 'court blocks trump s ban');
  assert.equal(normalizeTitle('eng vs sl'), 'eng vs sl');
  assert.equal(normalizeTitle('soup'), null);
  assert.equal(normalizeTitle('two words'), null);
});

test('keysOf combines url and title keys', () => {
  assert.deepEqual(keysOf({ title: 'A soup can story', url: 'https://x.com/a?utm_medium=y' }), ['url:https://x.com/a', 'title:a soup can story']);
  assert.deepEqual(keysOf({ title: 'soup', url: null }), []);
});

test('dedupe keeps the first of equal candidates, by url or by title', () => {
  const a = { title: 'Electric chair museum reopens', url: 'https://news.example.com/chair' };
  const sameUrl = { title: 'Museum of chairs opens again today', url: 'http://www.news.example.com/chair/?utm_source=rss' };
  const sameTitle = { title: 'Electric Chair Museum Reopens', url: 'https://other.example.org/story' };
  const other = { title: 'Brillo boxes found in warehouse', url: 'https://x.org/boxes' };
  const { fresh, duplicates } = dedupe([a, sameUrl, sameTitle, other]);
  assert.deepEqual(fresh, [a, other]);
  assert.deepEqual(duplicates, [sameUrl, sameTitle]);
});

test('dedupe checks against subjects already on the floor, without mutating the seen set', () => {
  const events = [
    { type: 'subject.posted', payload: { title: 'Electric chair museum reopens', url: 'https://news.example.com/chair' } },
    { type: 'chatter.posted', payload: { title: 'Brillo boxes found in warehouse' } },
  ];
  const seen = subjectKeys(events);
  const size = seen.size;
  const { fresh } = dedupe(
    [
      { title: 'Electric chair museum reopens', url: 'https://elsewhere.org/x' },
      { title: 'Brillo boxes found in warehouse', url: 'https://x.org/boxes' },
    ],
    seen,
  );
  assert.deepEqual(fresh.map((c) => c.url), ['https://x.org/boxes']);
  assert.equal(seen.size, size);
});

test('candidates with neither a usable url nor title are always fresh', () => {
  const { fresh } = dedupe([{ title: 'soup', url: null }, { title: 'soup', url: null }]);
  assert.equal(fresh.length, 2);
});
