#!/usr/bin/env node
/**
 * THE BRAND GUARDRAIL.
 *
 * Road Wild is two codebases -- this marketing site and the app -- and two
 * codebases is where a brand goes to drift. This script is the bill for that.
 *
 * WHAT IT DOES: fetches the deployed app, finds the hashed stylesheet Vite
 * actually shipped, and reads the :root / .dark custom properties out of it.
 * Those become site/assets/brand.css, which is the ONLY place this site gets a
 * colour from.
 *
 * WHY IT READS THE DEPLOYED CSS AND NOT A TOKENS FILE: because a tokens file
 * that a human maintains alongside the real ones is the drift problem moved one
 * file to the left. src/index.css in the app is the brand for both sites. The
 * app's *deployed* CSS is the source of truth -- not its source, not a copy,
 * not this repo.
 *
 * WHY AN UNREACHABLE APP IS A FAILURE AND NOT A FALLBACK: a check that quietly
 * builds from stale values when it cannot reach the app is not a check. Never
 * let a failed read look like an empty result -- that is the house rule on this
 * project and the most expensive bug shape in its history. The escape hatch is
 * ALLOW_BRAND_OFFLINE=1, which builds but says loudly that the colours are
 * unverified.
 *
 * MODES
 *   node scripts/sync-brand.mjs            build  -- Netlify runs this. Drift fails the deploy.
 *   node scripts/sync-brand.mjs --check    check  -- prints the diff. Same exit codes.
 *   node scripts/sync-brand.mjs --accept   accept -- a DELIBERATE colour change:
 *                                          change it in the app, PUBLISH, then run
 *                                          this and commit brand.tokens.json.
 *   --offline                              same as ALLOW_BRAND_OFFLINE=1.
 *
 * brand.tokens.json is written by this script. Do not hand-edit it.
 * site/assets/brand.css is generated and gitignored. Do not commit it.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_FILE = path.join(ROOT, 'brand.tokens.json');
const OUT_CSS = path.join(ROOT, 'site', 'assets', 'brand.css');

// Overridable only so the very first Netlify build can get through before
// app.roadwild.org exists. REMOVE THE OVERRIDE once the app is on its subdomain
// -- pointed anywhere else, this check is theatre.
const APP_ORIGIN = (process.env.APP_ORIGIN || 'https://app.roadwild.org').replace(/\/+$/, '');

const argv = new Set(process.argv.slice(2));
const MODE = argv.has('--accept') ? 'accept' : argv.has('--check') ? 'check' : 'build';
// Accept the spellings a person actually types. Requiring the literal string
// "1" and then saying nothing when it is not that is a trap: the build fails
// with "the app is unreachable" while the operator is looking at a variable
// they believe they set. Whatever is rejected here is REPORTED below.
const OFFLINE_RAW = (process.env.ALLOW_BRAND_OFFLINE ?? '').trim();
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const ALLOW_OFFLINE = argv.has('--offline') || TRUTHY.has(OFFLINE_RAW.toLowerCase());

// Hosts that serve the MARKETING site. If APP_ORIGIN names one of these it is
// pointed at this site rather than the app -- the classic stale-variable state
// after the apex moves to Netlify mid-cutover.
const MARKETING_HOSTS = new Set(['roadwild.org', 'www.roadwild.org']);

// The two selectors that carry the brand. Anything else in the app's CSS is the
// app's business.
const SELECTORS = [':root', '.dark'];

// ---------------------------------------------------------------------------
// CSS parsing
// ---------------------------------------------------------------------------
// Deliberately a real brace-walker rather than a regex. The app's CSS arrives
// minified and Tailwind wraps things in @layer, so ":root{" is not reliably
// where a regex expects it, and a regex that silently matches nothing would
// report "no drift" -- the exact failure this file exists to prevent.

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function eachRule(css, cb) {
  let sel = '';
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      const body = css.slice(i + 1, j - 1);
      const selector = sel.trim();
      if (selector.startsWith('@')) {
        // Descend into conditional groups; @layer base is where Tailwind puts these.
        if (/^@(media|supports|layer|container|scope)\b/i.test(selector)) eachRule(body, cb);
      } else if (selector) {
        cb(selector, body);
      }
      sel = '';
      i = j;
    } else if (ch === '}') {
      sel = '';
      i++;
    } else {
      sel += ch;
      i++;
    }
  }
}

// Compare MEANING, not formatting.
//
// The app's source writes 'Inter' and 0.75rem; the build minifies those to
// "Inter" and .75rem. Same values, different serialization -- and a raw string
// comparison reports all of it as drift. That is a false alarm that fires on
// every deploy and on the daily Action, and a check that cries wolf is a check
// people learn to ignore.
//
// Only provably value-preserving differences are normalized here: quote style,
// and a leading zero on a decimal. Anything that could change a rendered colour
// is left exactly as it is.
function canon(value) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/'/g, '"')
    // .75rem -> 0.75rem, at a value boundary so 1.5 is untouched
    .replace(/(^|[\s,(])\.(\d)/g, '$10.$2');
}

function extractTokens(css) {
  const out = Object.fromEntries(SELECTORS.map((s) => [s, {}]));
  eachRule(stripComments(css), (selector, body) => {
    const parts = selector.split(',').map((s) => s.trim());
    for (const target of SELECTORS) {
      if (!parts.includes(target)) continue;
      for (const m of body.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)(?:;|$)/g)) {
        // Later declarations win, same as the cascade.
        out[target][m[1]] = canon(m[2]);
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Fetching the deployed app
// ---------------------------------------------------------------------------

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'roadwild-brand-sync (+https://roadwild.org)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

async function fetchDeployedTokens() {
  const html = await fetchText(`${APP_ORIGIN}/`);

  const appOrigin = new URL(APP_ORIGIN).origin;
  const cssUrls = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /rel\s*=\s*["']?stylesheet/i.test(tag))
    .map((tag) => (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1])
    .filter(Boolean)
    .map((href) => new URL(href, `${APP_ORIGIN}/`))
    // Same-origin only: Google Fonts is a stylesheet too, and it is not the brand.
    .filter((u) => u.origin === appOrigin && u.pathname.endsWith('.css'));

  if (!cssUrls.length) {
    throw new Error(
      `no same-origin stylesheet linked from ${APP_ORIGIN}/ — refusing to guess at the brand`,
    );
  }

  let css = '';
  for (const u of cssUrls) css += `\n${await fetchText(u.href)}`;

  const tokens = extractTokens(css);
  if (!Object.keys(tokens[':root']).length) {
    throw new Error(
      `fetched ${cssUrls.length} stylesheet(s) from ${APP_ORIGIN} but found no :root custom properties — ` +
        'the app may have shipped a build without the brand layer',
    );
  }
  return { tokens, sources: cssUrls.map((u) => u.pathname) };
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

function diffTokens(baseline, current) {
  const changes = [];
  for (const sel of SELECTORS) {
    const a = baseline?.[sel] || {};
    const b = current?.[sel] || {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[key] === b[key]) continue;
      if (a[key] === undefined) changes.push({ sel, key, kind: 'added', from: null, to: b[key] });
      else if (b[key] === undefined) changes.push({ sel, key, kind: 'removed', from: a[key], to: null });
      else changes.push({ sel, key, kind: 'changed', from: a[key], to: b[key] });
    }
  }
  return changes.sort((x, y) => x.sel.localeCompare(y.sel) || x.key.localeCompare(y.key));
}

const describe = (c) =>
  c.kind === 'added'
    ? `${c.sel} ${c.key}  (new)  → ${c.to}`
    : c.kind === 'removed'
      ? `${c.sel} ${c.key}  ${c.from} → (gone)`
      : `${c.sel} ${c.key}  ${c.from} → ${c.to}`;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function renderCss(tokens, note) {
  const block = (sel, map, indent = '') =>
    [
      `${indent}${sel} {`,
      ...Object.entries(map).map(([k, v]) => `${indent}  ${k}: ${v};`),
      `${indent}}`,
    ].join('\n');

  return [
    '/* GENERATED FILE — do not edit, do not commit.',
    ' *',
    ' * Written by scripts/sync-brand.mjs from the CSS the app actually shipped.',
    ` * Source: ${note}`,
    ' *',
    ' * Every colour on this site resolves to one of these. If you find yourself',
    ' * wanting a hex literal in styles.css, the colour belongs in the app first.',
    ' */',
    '',
    block(':root', tokens[':root']),
    '',
    block('.dark', tokens['.dark']),
    '',
    '/* Follow the visitor\'s OS setting, unless the page has explicitly opted out. */',
    '@media (prefers-color-scheme: dark) {',
    block(':root:not(.light)', tokens['.dark'], '  '),
    '}',
    '',
  ].join('\n');
}

function summarise(lines) {
  const text = lines.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    // Best effort: a failed summary write must not change the exit code.
    import('node:fs')
      .then(({ appendFileSync }) => appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`))
      .catch(() => {});
  }
}

function die(lines) {
  summarise(lines);
  process.exit(1);
}

// ---------------------------------------------------------------------------

async function main() {
  const baseline = existsSync(TOKENS_FILE)
    ? JSON.parse(await readFile(TOKENS_FILE, 'utf8'))
    : null;

  // A baseline committed before canon() existed carries raw source formatting.
  // Normalize it on read so the diff compares like with like.
  if (baseline?.tokens) {
    for (const sel of SELECTORS) {
      for (const [k, v] of Object.entries(baseline.tokens[sel] || {})) {
        baseline.tokens[sel][k] = canon(v);
      }
    }
  }

  let tokens;
  let note;
  let unverified = false;

  try {
    const fetched = await fetchDeployedTokens();
    tokens = fetched.tokens;
    note = `${APP_ORIGIN} → ${fetched.sources.join(', ')}`;
  } catch (err) {
    if (MODE === 'accept') {
      die([
        '## Brand: cannot accept',
        '',
        `Could not read the deployed app at ${APP_ORIGIN}: ${err.message}`,
        '',
        'Accepting a colour change means recording what the app *actually ships*.',
        'There is nothing to record while the app is unreachable, and ALLOW_BRAND_OFFLINE',
        'does not apply here — it would just re-accept the values already committed.',
      ]);
    }
    if (!ALLOW_OFFLINE) {
      // Say what was actually configured. A guardrail that fires without
      // showing its inputs sends people to look in the wrong place.
      const notes = [];

      let host = '';
      try { host = new URL(APP_ORIGIN).host; } catch { /* keep the raw string */ }

      if (MARKETING_HOSTS.has(host)) {
        notes.push(
          '',
          `>> APP_ORIGIN is ${APP_ORIGIN}, which is the MARKETING SITE — this site — not the app.`,
          '   That value is only correct while the apex still serves the app. Once DNS moves',
          '   to Netlify it points the check at this deploy, which 404s. DELETE the variable:',
          '   the default is https://app.roadwild.org, which is where the app lives now.',
        );
      }

      if (OFFLINE_RAW && !ALLOW_OFFLINE) {
        notes.push(
          '',
          `>> ALLOW_BRAND_OFFLINE is set to "${OFFLINE_RAW}", which is not one of`,
          `   ${[...TRUTHY].join(', ')} — so it did NOT apply and this build stopped anyway.`,
        );
      }

      die([
        '## Brand check FAILED — the app is unreachable',
        '',
        `${APP_ORIGIN} → ${err.message}`,
        ...notes,
        '',
        'This is the guardrail, not a bug. Building from the last known-good colours',
        'would ship a site whose brand nobody has verified, and it would keep doing so',
        'silently for as long as the app stayed down.',
        '',
        'If the app genuinely is not up yet (first deploy, before app.roadwild.org exists):',
        '  set APP_ORIGIN to a host that IS serving the app, and remove it once the',
        '  subdomain is live.',
        'If you need this one build to go out regardless:',
        '  ALLOW_BRAND_OFFLINE=1 — the colours will be unverified and it will say so.',
      ]);
    }
    if (!baseline) {
      die([
        '## Brand check FAILED — unreachable app and no baseline',
        '',
        `${APP_ORIGIN} → ${err.message}`,
        '',
        'ALLOW_BRAND_OFFLINE falls back to brand.tokens.json, and there is no',
        'brand.tokens.json to fall back to. There is nothing to build from.',
      ]);
    }
    tokens = baseline.tokens;
    note = `NOT FETCHED — fell back to brand.tokens.json recorded ${baseline.acceptedAt}`;
    unverified = true;
  }

  if (MODE === 'accept') {
    const changes = baseline ? diffTokens(baseline.tokens, tokens) : [];
    await writeFile(
      TOKENS_FILE,
      `${JSON.stringify(
        { source: APP_ORIGIN, acceptedAt: new Date().toISOString(), tokens },
        null,
        2,
      )}\n`,
    );
    await mkdir(path.dirname(OUT_CSS), { recursive: true });
    await writeFile(OUT_CSS, renderCss(tokens, note));
    summarise([
      '## Brand accepted',
      '',
      `Recorded ${Object.keys(tokens[':root']).length} :root and ` +
        `${Object.keys(tokens['.dark']).length} .dark properties from ${note}.`,
      '',
      changes.length
        ? ['Changes taken:', '', ...changes.map((c) => `  ${describe(c)}`)].join('\n')
        : 'No change from the previous baseline.',
      '',
      'Commit brand.tokens.json.',
    ]);
    return;
  }

  if (!baseline) {
    die([
      '## Brand check FAILED — no baseline',
      '',
      'brand.tokens.json does not exist, so there is nothing to compare the app against.',
      'Establish it deliberately rather than letting a build invent one:',
      '',
      '  npm run brand:accept   # then commit brand.tokens.json',
    ]);
  }

  const changes = diffTokens(baseline.tokens, tokens);

  await mkdir(path.dirname(OUT_CSS), { recursive: true });
  await writeFile(OUT_CSS, renderCss(tokens, note));

  if (changes.length) {
    die([
      '## Brand DRIFT — the app and this site disagree',
      '',
      `${changes.length} propert${changes.length === 1 ? 'y has' : 'ies have'} moved since ` +
        `brand.tokens.json was accepted (${baseline.acceptedAt}):`,
      '',
      '```',
      ...changes.map((c) => `  ${describe(c)}`),
      '```',
      '',
      'If the app changed on purpose, take the change:',
      '',
      '  npm run brand:accept   # then commit brand.tokens.json',
      '',
      'If it did not, the app changed by accident and this site just caught it.',
    ]);
  }

  summarise([
    unverified ? '## Brand: UNVERIFIED (built offline)' : '## Brand: in sync',
    '',
    unverified
      ? `Could not reach the app. Built from brand.tokens.json accepted ${baseline.acceptedAt}. ` +
        'The colours on this deploy have not been checked against anything.'
      : `${Object.keys(tokens[':root']).length} :root and ${Object.keys(tokens['.dark']).length} ` +
        `.dark properties match brand.tokens.json.`,
    '',
    `Source: ${note}`,
  ]);
}

main().catch((err) => {
  die(['## Brand check FAILED', '', String(err?.stack || err)]);
});
