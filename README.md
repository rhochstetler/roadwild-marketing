# roadwild-marketing

The public face of **Road Wild** at `roadwild.org`. Static HTML on Netlify.

The app is a different thing on a different host: `app.roadwild.org`, the Base44
repo. That split is the whole reason this repo exists.

---

## Why there are two sites

The app is a JS bundle behind a login wall. A crawler that does not execute JS
sees nothing there, so the app can never rank for its own name. This site is
static HTML a crawler can read. The split also means marketing copy can ship
without publishing the app.

|                    | roadwild.org        | app.roadwild.org      |
| ------------------ | ------------------- | --------------------- |
| What               | marketing site      | the app               |
| Repo               | this one            | the Base44 repo       |
| Host               | Netlify             | Base44                |
| Indexed            | **yes**             | no — sends `noindex`  |

**The cost of the split is a second codebase, which is where a brand goes to
drift.** Most of the machinery in here exists to pay that bill.

---

## Layout

```
netlify.toml               build config + redirects. THE /functions/* RULE IS LOAD-BEARING.
brand.tokens.json          the accepted brand. Written by the script — do not hand-edit.
scripts/sync-brand.mjs     the guardrail. Reads the app's DEPLOYED css.
scripts/serve.mjs          local preview, no dependencies.
site/                      what gets published.
  index.html               the landing page
  features.html            what exists today
  pricing.html             free / beta / paid. THE "IN DEVELOPMENT" TAGS ARE LOAD-BEARING.
  about.html               why it exists, where the map came from
  beta.html                the waitlist form
  404.html                 not in sitemap.xml — an error page is not content
  privacy.html terms.html  scoped to THIS SITE — see the note at the top of each
  assets/styles.css        layout and type. Every colour is var(--something).
  assets/brand.css         GENERATED + GITIGNORED. Never commit, never hand-edit.
  assets/site.js           the waitlist form. The only script on the site.
.github/workflows/brand-drift.yml   daily drift check
```

## Setting up the Netlify project

The build is configured in `netlify.toml` — leave the build command, publish
directory and Node version blank in the Netlify UI. A value typed there becomes
an override that silently wins over the file, forever.

Connect the repo, then set `APP_ORIGIN` **according to where the app is actually
served right now**. This is the part that catches people, because the correct
value changes during the cutover:

| The app is served from        | Set                          |
| ----------------------------- | ---------------------------- |
| `app.roadwild.org` (the end state) | nothing — that is the default |
| `roadwild.org`, pre-cutover   | `APP_ORIGIN=https://roadwild.org` |
| nowhere reachable yet         | `ALLOW_BRAND_OFFLINE=1`      |

**`APP_ORIGIN=https://roadwild.org` is only valid while the apex still points at
the app.** The moment DNS moves to Netlify, that setting aims the brand check at
this site instead of the app: the fetch returns Netlify's own 404, the build
fails, and the error looks like a brand problem rather than a stale setting.
Delete it when you move DNS.

`ALLOW_BRAND_OFFLINE=1` is the honest way to get a first deploy out before the
app has a reachable home. It builds from the committed `brand.tokens.json` and
says in the log that the colours are unverified. Remove it as soon as
`app.roadwild.org` answers.

After the app is live on its own host: remove both variables, redeploy, then run
`npm run brand:accept` and commit. Until that runs, `brand.tokens.json` is
seeded from the app's source rather than from a deployed build — the file says
so in a `provisional` field, and the daily drift Action is not meaningful until
it is replaced.

## Local

```bash
npm run dev          # serves site/ on :4173
```

`dev` builds the brand offline, so it works without reaching the app. Netlify's
redirects do not apply locally, so `/functions/*` and the app routes 404 here.
That is expected.

---

## The brand guardrail

**`src/index.css` in the app is the brand for both sites. This repo keeps no
copy of it.**

`scripts/sync-brand.mjs` fetches `app.roadwild.org`, finds the hashed stylesheet
Vite actually shipped, and reads the `:root` / `.dark` custom properties out of
it. It deliberately does *not* read a tokens file that a human maintains
alongside the real ones — that is the drift problem moved one file to the left.
The app's **deployed CSS** is the source of truth.

| Layer                          | Fires                     | On drift          |
| ------------------------------ | ------------------------- | ----------------- |
| Netlify build command          | every marketing deploy    | **deploy fails**  |
| `.github/workflows/brand-drift.yml` | daily 08:15 UTC + push/PR | red run + summary |
| `npm run brand:check`          | on demand                 | prints the diff   |
| `.github/workflows/brand-accept.yml` | manual (Run workflow)     | takes the change  |

The daily Action is the important one. The build check only fires when this site
deploys, which is blind to the likelier case: a colour changes in the app,
marketing does not rebuild for weeks, and the two look different to anyone who
visits both.

### Rules

- **Every colour in `site/assets/styles.css` is `var(--something)`. No hex, no
  literal `hsl()`.** A hardcoded colour is invisible to the check. Shades and
  tints the app does not define are derived with `color-mix()` against
  `--foreground` / `--background`, never pasted in as new values — a derived
  colour follows the app and inverts correctly in dark mode; a pasted one does
  neither. The hero illustration is tokenised the same way (`.scene-*`).
- **Two exceptions, both unavoidable and both annotated in place:**
  `site/favicon.svg` and the `theme-color` meta on each page. Neither can read a
  CSS variable, so both carry `#2D6A4F` (= `--primary`) by hand. **The drift
  check cannot see either one.** If `--primary` changes in the app, change these
  two by hand; nothing will tell you to.
- `site/assets/brand.css` is **generated and gitignored**. Do not commit it, do
  not hand-edit it.
- `brand.tokens.json` is written by the script. Do not hand-edit it either.
- **Deliberate colour change:** change it in the app → **publish** → re-baseline
  here → the next deploy goes green. Two ways to re-baseline:
  - **From GitHub** (no clone needed): Actions → **brand accept** → Run workflow.
    It runs `brand:accept` against the deployed app and commits the result, and
    it does nothing if the values are unchanged.
  - **Locally:** `npm run brand:accept`, then commit `brand.tokens.json`.

  Either way, **publish the app first.** Both read the app's *deployed* CSS, so
  accepting an unpublished change records the old value and the check goes red
  again on the next deploy.
- An unreachable app **fails** rather than building from stale values. Escape
  hatch is `ALLOW_BRAND_OFFLINE=1`, which builds but logs that the colours are
  unverified.

---

## Things that will bite you

**The `/functions/*` redirect in `netlify.toml` is load-bearing.** `createShareLink`
in the app mints `roadwild.org/functions/sharedPlace?t=TOKEN`. Those tokens never
expire, some were texted to people outside the app, and they cannot be reissued.
Deleting that rule breaks them permanently.

**App routes are enumerated, not wildcarded, on purpose.** A catch-all `/*` would
forward this site's own pages to the app — every marketing page added from here
on would silently vanish the day it shipped. Add a route to `src/App.jsx`, add it
to `netlify.toml` too.

**CORS is an exact allowlist, not a wildcard.** `betaSignup`'s `ALLOWED_ORIGINS`
holds `https://roadwild.org` and `https://www.roadwild.org`. If you add a
hostname for this site — staging, a deploy preview, another spelling — the form
fails there until that origin is added **and the app is published**. Deploy
previews cannot submit the form. That is not a bug to route around.

**Committing a Base44 function does not deploy it.** The editor preview serves
the new frontend against the still-published old backend, so a change spanning
both looks broken in preview and fine in code. Until the app is published,
`betaSignup` does not exist and this form fails at submit while looking correct
in every file you can read.

**Header and footer are duplicated in every page.** This is a static site with
no template step, so a change to the nav has to be made in all eight files.
Grep before you edit one.

**The legal pages here are scoped to this website.** They are not the Road Wild
privacy policy or terms of service — those govern the app, live outside this
repo, and are linked from these pages. Do not grow these into full copies:
two versions of one legal document, drifting, is worse than one and a link, and
nothing checks these daily the way the colours are checked.

---

## Content rules

Each of these is load-bearing, not a style preference.

- **Nothing unbuilt is promised.** Offline maps, meetups and the AI activity
  finder are marked *in development* in the pricing block, because the terms of
  service say in writing that they do not exist. Contradicting that makes a
  published legal document false.
- **No testimonials, and none invented.** There are no beta testers yet. The
  "what you're actually signing up for" section stands in until real people have
  said real things — delete it then, not before.
- **No analytics, no cookies, no pixel, no tag manager.** The only attribution is
  the `?ref=` string typed into Robyn's own links, carried into
  `BetaSignup.source`. The privacy policy says this plainly; adding a script
  makes it false. The CSP in `netlify.toml` has no `'unsafe-inline'` for
  scripts or styles, which is also why there is no `style=""` attribute
  anywhere — use a class.
- **No hero photo and no `og:image`** until a licensed one exists. The hero is a
  drawn SVG scene instead, built from the brand tokens. Add a photo and an
  `og:image` together, never one without the other.
- **The spot count rounds down.**
