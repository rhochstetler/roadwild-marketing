#!/usr/bin/env node
// Build the public state pages: site/camping/<state>.html and site/camping/index.html.
//
// INPUT is data/states/<code>.json in exactly the shape exportPublicSpots
// returns (spots + activities for one state, already filtered by the public
// rules in the app). Nothing here decides what is public -- the export does.
// This script only lays out what it is given, plus the hand-written intros in
// data/intros.json.
//
// NEVER ADD COORDINATES. The export does not carry them and this page must not
// either: a state page says roughly where a spot is (nearest town) and sends
// people to the app for the pin.
//
// NO DEPENDENCIES, matching scripts/sync-brand.mjs. Plain string templates.
//
//   node scripts/build-state-pages.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'states');
const OUT = join(ROOT, 'site', 'camping');
const SITE = 'https://roadwild.org';

// Under this many public spots a page is built but kept out of the index
// (spec Q3). A sample-data page is ALWAYS noindex: it is a preview.
const NOINDEX_BELOW = 10;
const ROWS_BEFORE_FOLD = 25;

const STATES = {
  AL: ['Alabama', 'South'], AK: ['Alaska', 'West'], AZ: ['Arizona', 'Southwest'], AR: ['Arkansas', 'South'],
  CA: ['California', 'West'], CO: ['Colorado', 'Mountain West'], CT: ['Connecticut', 'Northeast'],
  DE: ['Delaware', 'Northeast'], DC: ['District of Columbia', 'Northeast'], FL: ['Florida', 'South'],
  GA: ['Georgia', 'South'], HI: ['Hawaii', 'West'], ID: ['Idaho', 'Mountain West'], IL: ['Illinois', 'Midwest'],
  IN: ['Indiana', 'Midwest'], IA: ['Iowa', 'Midwest'], KS: ['Kansas', 'Midwest'], KY: ['Kentucky', 'South'],
  LA: ['Louisiana', 'South'], ME: ['Maine', 'Northeast'], MD: ['Maryland', 'Northeast'],
  MA: ['Massachusetts', 'Northeast'], MI: ['Michigan', 'Midwest'], MN: ['Minnesota', 'Midwest'],
  MS: ['Mississippi', 'South'], MO: ['Missouri', 'Midwest'], MT: ['Montana', 'Mountain West'],
  NE: ['Nebraska', 'Midwest'], NV: ['Nevada', 'Southwest'], NH: ['New Hampshire', 'Northeast'],
  NJ: ['New Jersey', 'Northeast'], NM: ['New Mexico', 'Southwest'], NY: ['New York', 'Northeast'],
  NC: ['North Carolina', 'South'], ND: ['North Dakota', 'Midwest'], OH: ['Ohio', 'Midwest'],
  OK: ['Oklahoma', 'Southwest'], OR: ['Oregon', 'West'], PA: ['Pennsylvania', 'Northeast'],
  RI: ['Rhode Island', 'Northeast'], SC: ['South Carolina', 'South'], SD: ['South Dakota', 'Midwest'],
  TN: ['Tennessee', 'South'], TX: ['Texas', 'Southwest'], UT: ['Utah', 'Mountain West'],
  VT: ['Vermont', 'Northeast'], VA: ['Virginia', 'South'], WA: ['Washington', 'West'],
  WV: ['West Virginia', 'South'], WI: ['Wisconsin', 'Midwest'], WY: ['Wyoming', 'Mountain West'],
};
const REGIONS = ['West', 'Mountain West', 'Southwest', 'Midwest', 'South', 'Northeast'];

const NEIGHBORS = {
  AL: 'FL GA MS TN', AK: '', AZ: 'CA CO NM NV UT', AR: 'LA MO MS OK TN TX', CA: 'AZ NV OR',
  CO: 'AZ KS NE NM OK UT WY', CT: 'MA NY RI', DE: 'MD NJ PA', DC: 'MD VA', FL: 'AL GA',
  GA: 'AL FL NC SC TN', HI: '', ID: 'MT NV OR UT WA WY', IL: 'IA IN KY MO WI', IN: 'IL KY MI OH',
  IA: 'IL MN MO NE SD WI', KS: 'CO MO NE OK', KY: 'IL IN MO OH TN VA WV', LA: 'AR MS TX', ME: 'NH',
  MD: 'DC DE PA VA WV', MA: 'CT NH NY RI VT', MI: 'IN OH WI', MN: 'IA ND SD WI', MS: 'AL AR LA TN',
  MO: 'AR IA IL KS KY NE OK TN', MT: 'ID ND SD WY', NE: 'CO IA KS MO SD WY', NV: 'AZ CA ID OR UT',
  NH: 'MA ME VT', NJ: 'DE NY PA', NM: 'AZ CO OK TX UT', NY: 'CT MA NJ PA VT', NC: 'GA SC TN VA',
  ND: 'MN MT SD', OH: 'IN KY MI PA WV', OK: 'AR CO KS MO NM TX', OR: 'CA ID NV WA',
  PA: 'DE MD NJ NY OH WV', RI: 'CT MA', SC: 'GA NC', SD: 'IA MN MT ND NE WY',
  TN: 'AL AR GA KY MO MS NC VA', TX: 'AR LA NM OK', UT: 'AZ CO ID NM NV WY', VT: 'MA NH NY',
  VA: 'DC KY MD NC TN WV', WA: 'ID OR', WV: 'KY MD OH PA VA', WI: 'IA IL MI MN',
  WY: 'CO ID MT NE SD UT',
};

// Spot groups, in page order. Words chosen to describe the listing, never to
// promise what a night there is like: no "free", no "legal".
const GROUPS = [
  { key: 'campground', title: 'Campgrounds', types: ['paid_camp'] },
  { key: 'rv', title: 'RV parks', types: ['rv_park'] },
  { key: 'primitive', title: 'Dispersed and primitive camping', types: ['free_camp', 'boondocking', 'blm'] },
  { key: 'other', title: 'Other overnight stops', types: ['walmart', 'truck_stop', 'rest_stop', 'retail'] },
  { key: 'unknown', title: 'Spot, type unconfirmed', types: ['unknown'] },
];

// Strongest first. Mirrors the badge order in exportPublicSpots.
const BADGES = {
  nomad: { label: 'Verified by a nomad', tone: 'sage', why: 'A Road Wild member reported on it from the ground.' },
  agency: { label: 'Agency record', tone: 'sage', why: 'Matched to an official listing on Recreation.gov.' },
  policy: { label: 'Overnight policy sourced', tone: 'sky', why: 'We have a source for whether overnight stays are allowed.' },
  access_checked: { label: 'Access checked', tone: 'sky', why: 'Someone researched how you get in. Not a confirmation that overnight stays are allowed.' },
  listed_business: { label: 'Listed business, not yet confirmed', tone: 'plain', why: 'A private campground or RV park from map data. We have not yet confirmed it is open.' },
};

// Within each group, stronger badges come first (decided 2026-10-07): most
// public spots are unconfirmed listed businesses, and a page that opens on
// those buries the agency and research-checked rows. Unknown badges sort last.
const BADGE_ORDER = Object.keys(BADGES);
function badgeRank(b) {
  const i = BADGE_ORDER.indexOf(b);
  return i === -1 ? BADGE_ORDER.length : i;
}

const ACTIVITY_GROUPS = [
  { title: 'Outdoors', types: ['hiking', 'camping', 'hot_springs', 'rock_climbing', 'fishing', 'biking', 'paddling', 'boating', 'swimming', 'wildlife_viewing', 'birding', 'horseback_riding', 'winter_sports', 'scenic_drive', 'off_roading', 'hunting', 'picnicking', 'stargazing', 'caving', 'photography'] },
  { title: 'Culture and history', types: ['historic_site', 'interpretive_program', 'museum', 'arts_culture', 'historic_downtown', 'plaza', 'live_music', 'science_center', 'planetarium', 'library', 'workshop_class'] },
  { title: 'Food and drink', types: ['brewery_distillery', 'market', 'local_eats'] },
  { title: 'Nomad services', types: ['laundromat', 'shower', 'dump_station', 'drinking_water', 'coworking'] },
];

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = name => name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
const fmt = n => n.toLocaleString('en-US');

// "Leavenworth, WA" on a Washington page reads as "Leavenworth"; a town over
// the border keeps its state.
function townLabel(town, code) {
  if (!town) return null;
  return town.endsWith(`, ${code}`) ? town.slice(0, -4) : town;
}
function whereText(spot, code) {
  const t = townLabel(spot.town, code);
  if (!t) return 'Nearest town not yet known';
  const mi = spot.town_mi;
  if (mi == null || mi <= 10) return `near ${t}`;
  return `${Math.round(mi)} mi from ${t}`;
}

function header() {
  return `    <header class="site-header">
      <div class="wrap">
        <a class="wordmark" href="/">
          <span class="mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
              <path d="M11 27 Q15 19 14.5 13 Q14 8 16 5" />
              <path d="M21 27 Q19 19 19 13 Q19 8 16 5" opacity=".55" />
            </svg>
          </span>
          Road Wild
        </a>
        <nav class="nav" aria-label="Primary">
          <a class="nav-hide" href="/features">Features</a>
          <a class="nav-hide" href="/pricing">Pricing</a>
          <a class="nav-hide" href="/about">About</a>
          <a class="btn btn-cta btn-sm" href="/beta">Request beta access</a>
        </nav>
      </div>
    </header>`;
}

function footer(osm) {
  return `    <footer class="site-footer">
      <div class="wrap">
        <div class="footer-grid">
          <div>
            <a class="wordmark" href="/">
              <span class="mark" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                  <path d="M11 27 Q15 19 14.5 13 Q14 8 16 5" />
                  <path d="M21 27 Q19 19 19 13 Q19 8 16 5" opacity=".55" />
                </svg>
              </span>
              Road Wild
            </a>
            <p class="footer-note">
              A map of overnight spots and things to do, for people who actually live on
              the road. Currently in private beta.
            </p>
          </div>
          <nav class="footer-links" aria-label="Footer">
            <a href="/camping">Camping by state</a>
            <a href="/features">Features</a>
            <a href="/pricing">Pricing</a>
            <a href="/about">About</a>
            <a href="/beta">Beta access</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </nav>
        </div>
        ${osm ? '<p class="footer-note">Some listings contain information from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; OpenStreetMap contributors, available under the Open Database License.</p>\n        ' : ''}<p class="footer-note">© <span id="year">2026</span> Road Wild.</p>
      </div>
    </footer>`;
}

function head({ title, description, path, noindex, crumbs }) {
  const ld = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: crumbs.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + url })),
  };
  return `  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${SITE}${path}" />
    ${noindex ? '<meta name="robots" content="noindex" />\n    ' : ''}<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="theme-color" content="#2D6A4F" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Road Wild" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${SITE}${path}" />
    <meta property="og:image" content="${SITE}/photos/og-index.jpg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/assets/styles.css" />
    <!-- NO ANALYTICS. NO COOKIES. NO PIXEL. Same promise as every page on this site. -->
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
  </head>`;
}

function badge(key) {
  const b = BADGES[key];
  return `<span class="spot-badge ${b.tone}" title="${esc(b.why)}">${esc(b.label)}</span>`;
}

function spotRows(spots, code) {
  return spots.map(s => `<li class="spot-row"><span class="spot-name">${esc(s.name)}</span><span class="spot-where">${esc(whereText(s, code))}</span>${badge(s.badge)}</li>`).join('\n');
}

function statePage(code, data, intro, built) {
  const [name] = STATES[code];
  const spots = data.spots || [];
  const acts = data.activities || [];
  const total = spots.length;
  const noindex = data.sample === true || total < NOINDEX_BELOW;
  const path = `/camping/${slug(name)}`;
  const osm = spots.some(s => s.osm) || acts.some(a => a.osm);

  const byGroup = GROUPS.map(g => ({
    ...g,
    spots: spots.filter(s => g.types.includes(s.type))
      .sort((a, b) => badgeRank(a.badge) - badgeRank(b.badge)
        || (townLabel(a.town, code) || '~').localeCompare(townLabel(b.town, code) || '~')
        || a.name.localeCompare(b.name)),
  })).filter(g => g.spots.length);

  const towns = {};
  for (const s of spots) { const t = townLabel(s.town, code); if (t && (s.town_mi ?? 0) <= 25) towns[t] = (towns[t] || 0) + 1; }
  const topTowns = Object.entries(towns).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);

  const actGroups = ACTIVITY_GROUPS.map(g => {
    const list = acts.filter(a => g.types.includes(a.type));
    return { ...g, count: list.length, examples: list.slice(0, 5) };
  }).filter(g => g.count);

  const neighbors = (NEIGHBORS[code] || '').split(' ').filter(Boolean)
    .map(c => built.has(c) ? `<a href="/camping/${slug(STATES[c][0])}">${esc(STATES[c][0])}</a>` : `<span class="muted">${esc(STATES[c][0])}</span>`);

  const title = `Camping in ${name}: ${fmt(total)} places to stay — Road Wild`;
  const description = `${fmt(total)} campgrounds, RV parks and backcountry camps in ${name}, each with its nearest town and where our information comes from. Check locally before you stay.`;

  const groupHtml = byGroup.map(g => {
    const first = g.spots.slice(0, ROWS_BEFORE_FOLD), rest = g.spots.slice(ROWS_BEFORE_FOLD);
    return `          <section class="spot-group" id="${g.key}" aria-labelledby="${g.key}-h">
            <h3 id="${g.key}-h">${esc(g.title)} <span class="count">${fmt(g.spots.length)}</span></h3>
            <ul class="spot-list">
${spotRows(first, code)}
            </ul>${rest.length ? `
            <details class="spot-more">
              <summary>Show all ${fmt(g.spots.length)}</summary>
              <ul class="spot-list">
${spotRows(rest, code)}
              </ul>
            </details>` : ''}
          </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
${head({ title, description, path, noindex, crumbs: [['Home', '/'], ['Camping', '/camping'], [name, path]] })}
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
${header()}
    <main id="main">${data.sample ? `
      <div class="preview-bar"><div class="wrap">${esc(data.sample_note)} This page is not indexed.</div></div>` : ''}
      <section class="state-hero">
        <div class="wrap">
          <nav class="crumbs small" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/camping">Camping</a> › ${esc(name)}</nav>
          <p class="eyebrow">Camping by state</p>
          <h1>Camping in ${esc(name)}</h1>
          <p class="lede">${fmt(total)} places to stay, each with its nearest town and where our information comes from.</p>
          ${intro ? `<div class="state-intro">${intro.split(/\n\n+/).map(p => `<p>${esc(p)}</p>`).join('')}</div>` : '<p class="muted small">Intro not written yet.</p>'}
        </div>
      </section>

      <section class="section-tight">
        <div class="wrap">
          <div class="glance">
${byGroup.map(g => `            <a class="glance-item" href="#${g.key}"><span class="glance-num">${fmt(g.spots.length)}</span><span class="glance-label">${esc(g.title)}</span></a>`).join('\n')}
            <div class="glance-item"><span class="glance-num">${fmt(acts.length)}</span><span class="glance-label">Things to do</span></div>
          </div>
          <p class="small muted mt-s">Data as of ${esc(data.generated_at)}.</p>
        </div>
      </section>

      <section class="section-tight">
        <div class="wrap">
          <div class="score-slot">
            <div>
              <p class="eyebrow">Boondocking Score</p>
              <h2>How easy is it to park free overnight in ${esc(name)}?</h2>
              <p class="muted">Coming soon: nomads will rate how easy it is to find a free, tolerated place to sleep here. A score shows once at least five people have reported.</p>
            </div>
            <a class="btn btn-ghost" href="/beta">Join the beta to add yours</a>
          </div>
        </div>
      </section>
${topTowns.length ? `
      <section class="section-tight">
        <div class="wrap">
          <h2 class="h-sm">Towns with the most places nearby</h2>
          <ul class="town-list">
${topTowns.map(([t, n]) => `            <li><span>${esc(t)}</span><span class="count">${fmt(n)}</span></li>`).join('\n')}
          </ul>
        </div>
      </section>
` : ''}
      <section>
        <div class="wrap">
          <div class="section-head">
            <h2>Places to stay</h2>
            <p class="lede">Strongest badge first, then by nearest town. The badge says where our information comes from. A badge is not permission to stay overnight.</p>
          </div>
${groupHtml}
          <div class="badge-key">
            <h3 class="h-sm">What the badges mean</h3>
            <ul>
${Object.keys(BADGES).map(k => `              <li>${badge(k)} <span>${esc(BADGES[k].why)}</span></li>`).join('\n')}
            </ul>
          </div>
        </div>
      </section>
${actGroups.length ? `
      <section class="section-alt">
        <div class="wrap">
          <div class="section-head">
            <h2>Things to do in ${esc(name)}</h2>
            <p class="lede">${fmt(acts.length)} places on the Road Wild map, from trailheads to laundromats.</p>
          </div>
          <div class="grid grid-2">
${actGroups.map(g => `            <article class="card">
              <h3>${esc(g.title)} <span class="count">${fmt(g.count)}</span></h3>
              <ul class="act-list">
${g.examples.map(a => `                <li>${esc(a.name)}${a.city ? ` <span class="muted">· ${esc(a.city)}</span>` : ''}</li>`).join('\n')}
              </ul>
            </article>`).join('\n')}
          </div>
        </div>
      </section>
` : ''}
      <section>
        <div class="wrap">
          <div class="check-locally">
            <h2 class="h-sm">Check locally</h2>
            <p>
              A listing is a lead, not a promise. These are places we know about, not places
              we have confirmed you can sleep tonight. Rules, closures, seasons and fees change,
              and forest roads and passes close for snow. Check signs and local rules before
              you commit to a night somewhere, and tell us when something is wrong.
            </p>
          </div>
        </div>
      </section>

      <section class="section-alt">
        <div class="wrap">
          <div class="cta-band">
            <h2>Get the details in the app</h2>
            <p>Maps, pins, photos, check-ins and reviews from nomads who stayed live in Road Wild. It's in private beta.</p>
            <a class="btn btn-cta" href="/beta">Request beta access</a>
          </div>
        </div>
      </section>
${neighbors.length ? `
      <section class="section-tight">
        <div class="wrap">
          <p class="small">Neighbouring states: ${neighbors.join(' · ')} · <a href="/camping">All states</a></p>
        </div>
      </section>
` : ''}    </main>

${footer(osm)}

    <script src="/assets/site.js" defer></script>
  </body>
</html>
`;
}

function indexPage(built, counts, anySample) {
  const title = 'Camping by state — Road Wild';
  const description = 'Campgrounds, RV parks and backcountry camps in every US state, with nearest towns and where our information comes from.';
  const regions = REGIONS.map(r => {
    const codes = Object.keys(STATES).filter(c => STATES[c][1] === r).sort((a, b) => STATES[a][0].localeCompare(STATES[b][0]));
    return `          <div class="region">
            <h3 class="h-sm">${esc(r)}</h3>
            <ul class="state-list">
${codes.map(c => built.has(c)
    ? `              <li><a href="/camping/${slug(STATES[c][0])}">${esc(STATES[c][0])}</a><span class="count">${fmt(counts[c])}</span></li>`
    : `              <li class="muted">${esc(STATES[c][0])}<span class="count">soon</span></li>`).join('\n')}
            </ul>
          </div>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en">
${head({ title, description, path: '/camping', noindex: anySample, crumbs: [['Home', '/'], ['Camping', '/camping']] })}
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
${header()}
    <main id="main">${anySample ? `
      <div class="preview-bar"><div class="wrap">Preview: only states with data are linked. This page is not indexed.</div></div>` : ''}
      <section>
        <div class="wrap">
          <div class="section-head">
            <p class="eyebrow">Camping by state</p>
            <h1>Where to stay, state by state</h1>
            <p class="lede">Campgrounds, RV parks and backcountry camps from the Road Wild map, with their nearest town and where our information comes from.</p>
          </div>
          <div class="regions">
${regions}
          </div>
        </div>
      </section>
    </main>

${footer(false)}

    <script src="/assets/site.js" defer></script>
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------

const intros = existsSync(join(ROOT, 'data', 'intros.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'data', 'intros.json'), 'utf8')) : {};
const files = existsSync(DATA) ? readdirSync(DATA).filter(f => /^[a-z]{2}\.json$/.test(f)) : [];
const loaded = {};
for (const f of files) {
  const code = f.slice(0, 2).toUpperCase();
  if (!STATES[code]) continue;
  const data = JSON.parse(readFileSync(join(DATA, f), 'utf8'));
  // Belt and braces: the export never sends these, and a page must never show them.
  const text = JSON.stringify(data);
  if (/"(lat|lon|lng|latitude|longitude|id|share_token)"\s*:/.test(text)) {
    throw new Error(`${f} contains a coordinate or id field. Refusing to build.`);
  }
  loaded[code] = data;
}
const built = new Set(Object.keys(loaded));
mkdirSync(OUT, { recursive: true });
const counts = {};
let anySample = false;
for (const [code, data] of Object.entries(loaded)) {
  counts[code] = (data.spots || []).length;
  anySample ||= data.sample === true;
  const file = join(OUT, `${slug(STATES[code][0])}.html`);
  writeFileSync(file, statePage(code, data, intros[code], built));
  console.log(`wrote ${file.replace(ROOT + '/', '')} (${counts[code]} spots)`);
}
writeFileSync(join(OUT, 'index.html'), indexPage(built, counts, anySample));
console.log(`wrote site/camping/index.html (${built.size} state${built.size === 1 ? '' : 's'})`);
