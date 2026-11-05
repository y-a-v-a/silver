// A small line diff (longest common subsequence), for showing what changed in a soul.
// Role files are a few hundred lines at most, so the quadratic table is fine.

/**
 * @param {string} a  old text
 * @param {string} b  new text
 * @returns {{op: 'same'|'add'|'del', text: string}[]}
 */
export function lineDiff(a, b) {
  const x = String(a ?? '').split('\n');
  const y = String(b ?? '').split('\n');
  // Common ends first, which is nearly everything for a typical edit.
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const midX = x.slice(start, endX);
  const midY = y.slice(start, endY);
  const table = Array.from({ length: midX.length + 1 }, () => new Uint32Array(midY.length + 1));
  for (let i = midX.length - 1; i >= 0; i--) {
    for (let j = midY.length - 1; j >= 0; j--) {
      table[i][j] = midX[i] === midY[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out = x.slice(0, start).map((text) => ({ op: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < midX.length || j < midY.length) {
    if (i < midX.length && j < midY.length && midX[i] === midY[j]) {
      out.push({ op: 'same', text: midX[i] });
      i++;
      j++;
    } else if (i < midX.length && (j === midY.length || table[i + 1][j] >= table[i][j + 1])) out.push({ op: 'del', text: midX[i++] });
    else out.push({ op: 'add', text: midY[j++] });
  }
  for (const text of x.slice(endX)) out.push({ op: 'same', text });
  return out;
}

/**
 * Only the changed lines, with `context` lines around them. Skipped stretches become
 * {op: 'skip', count}.
 */
export function compactDiff(diff, context = 2) {
  const keep = new Set();
  diff.forEach((d, i) => {
    if (d.op === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++) keep.add(k);
  });
  const out = [];
  let skipped = 0;
  diff.forEach((d, i) => {
    if (keep.has(i)) {
      if (skipped) out.push({ op: 'skip', count: skipped });
      skipped = 0;
      out.push(d);
    } else skipped++;
  });
  if (skipped) out.push({ op: 'skip', count: skipped });
  return out;
}

export const hasChanges = (diff) => diff.some((d) => d.op !== 'same');
