#!/usr/bin/env node
/**
 * Used by .github/workflows/brand-accept.yml, not by the build.
 *
 * Decides whether an accept produced anything worth committing, and writes the
 * run summary either way. Exits 0 when there IS something to commit, 1 when
 * there is not -- so the workflow can branch on it with a plain `if`.
 *
 * "Worth committing" means the token VALUES moved, or the baseline was still
 * carrying the `provisional` marker. A fresh acceptedAt on its own is churn.
 */
import { readFileSync } from 'node:fs';

const [, , beforePath, afterPath] = process.argv;
const before = JSON.parse(readFileSync(beforePath, 'utf8'));
const after = JSON.parse(readFileSync(afterPath, 'utf8'));

const changes = [];
for (const sel of [':root', '.dark']) {
  const a = before.tokens?.[sel] || {};
  const b = after.tokens?.[sel] || {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[key] === b[key]) continue;
    changes.push(`  ${sel} ${key}  ${a[key] ?? '(new)'} -> ${b[key] ?? '(gone)'}`);
  }
}

const hadProvisional = Boolean(before.provisional);

if (!changes.length && !hadProvisional) {
  console.log('## Brand: nothing to accept\n');
  console.log('The committed baseline already matches the CSS the app is serving.');
  process.exit(1);
}

console.log('## Brand accepted\n');
console.log('```');
console.log(
  changes.length
    ? changes.sort().join('\n')
    : '  no value changes — cleared the provisional marker',
);
console.log('```');
if (hadProvisional && !changes.length) {
  console.log(
    '\nThe baseline was seeded from the app source; it is now recorded from a deployed build.',
  );
}
process.exit(0);
