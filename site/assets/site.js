/* The waitlist form, and nothing else. This is the only script on the site.
 *
 * NOT IN HERE, DELIBERATELY: analytics, cookies, a pixel, a tag manager, a
 * consent banner. The privacy policy says in plain words that there are none,
 * so adding one makes a published document false. The only attribution is the
 * ?ref= string typed into Robyn's own links, read below and carried into
 * BetaSignup.source.
 */

(function () {
  'use strict';

  // The function lives on the APP host, not this one. Absolute on purpose:
  // the /functions/* rule in netlify.toml is a 301 for old share links, and a
  // browser turns a 301 on a POST into a GET -- routing the form through it
  // would drop the body and look like a server that silently ignores signups.
  var ENDPOINT = 'https://app.roadwild.org/functions/betaSignup';

  var form = document.getElementById('beta-form');
  var statusEl = document.getElementById('beta-status');
  var button = document.getElementById('beta-submit');

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  if (!form || !statusEl || !button) return;

  /* Which surface this submission came from. A ?ref= on a link Robyn posted
   * somewhere is the entire measurement stack -- it tells her which channel
   * actually works without a single third-party request. */
  function source() {
    try {
      var ref = new URLSearchParams(window.location.search).get('ref');
      if (ref) return ref.trim().slice(0, 60);
    } catch (e) {
      /* A malformed query string is not a reason to fail a signup. */
    }
    return 'landing';
  }

  function show(kind, message) {
    statusEl.className = 'status ' + (kind === 'ok' ? 'status-ok' : 'status-err');
    statusEl.textContent = message;
    statusEl.hidden = false;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var email = form.elements.email.value.trim();
    if (!email || email.indexOf('@') === -1) {
      show('err', 'Please enter an email address so we know where to send the invite.');
      form.elements.email.focus();
      return;
    }

    var payload = {
      email: email,
      name: form.elements.name.value.trim(),
      rig: form.elements.rig.value,
      stage: form.elements.stage.value,
      note: form.elements.note.value.trim(),
      source: source(),
      // The honeypot rides along exactly as filled. The server decides.
      company: form.elements.company.value,
    };

    button.disabled = true;
    statusEl.hidden = true;

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            return { ok: res.ok, status: res.status, body: body || {} };
          });
      })
      .then(function (result) {
        /* A FAILED SUBMIT MUST LOOK LIKE A FAILURE.
         *
         * Never show the success message for a request that did not land.
         * Someone who believes they are on the list and is not will simply
         * never hear from us again, and will never know to try again -- there
         * is no second signal anywhere in this flow to catch it. This is the
         * house rule: a failed write is never dressed up as a quiet success. */
        if (!result.ok) {
          show(
            'err',
            result.body.error ||
              "That didn't go through (error " +
                result.status +
                '). Try again, or email hello@roadwild.org and we\'ll add you by hand.',
          );
          button.disabled = false;
          return;
        }

        if (result.body.already) {
          show('ok', "You're already on the list — no need to sign up twice. Sit tight.");
        } else {
          show(
            'ok',
            "You're on the list. Check your email for a confirmation — invites go out in " +
              'batches, so it may be a little while.',
          );
        }

        form.reset();
        button.disabled = true;
        button.textContent = 'Done';
      })
      .catch(function () {
        /* Network failure, or CORS refusing the response. The likeliest cause
         * of the latter, by a wide margin, is this page being served from a
         * hostname that is not in betaSignup's ALLOWED_ORIGINS -- a deploy
         * preview, a staging host, or www vs apex. Adding the origin to that
         * allowlist is only half the fix: THE APP MUST THEN BE PUBLISHED, or
         * the deployed function still holds the old list. */
        show(
          'err',
          "That didn't go through — the connection failed. Try again, or email " +
            "hello@roadwild.org and we'll add you by hand.",
        );
        button.disabled = false;
      });
  });
})();
