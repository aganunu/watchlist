# Beta 15 stability audit

## Scope

This audit covers the canonical Beta 15 PWA at `index.html` on main after the
password-recovery rollout. It reviewed local state and backup safety, Supabase
Auth/recovery and manual sync, routing/history, the service worker, the local
allowlisted server, TMDB identity/search paths, playback progress and cleanup,
and baseline mobile/keyboard accessibility.

The automated suite is deliberately isolated: Supabase, TMDB, pinned base data,
and CDN requests are intercepted. It never uses production credentials, sends
recovery email, changes a password, writes cloud data, or clears a real browser
profile.

## Bugs found and fixed

1. **Malformed `watchlist_v3` could prevent startup.** Valid JSON such as
   `null`, wrong top-level collection types, invalid identity aliases, or broken
   added-item records could make startup/rebuild throw. State now receives a
   conservative in-memory shape normalization on load, import, merge, cloud
   pull, and undo. Startup does not write the normalized value back, so the
   original stored payload remains available unless the user later performs a
   normal state-changing action.
2. **Imported titles could escape legacy inline action handlers.** The fallback
   detail modal embedded a library ID in inline JavaScript. HTML entity decoding
   made a crafted imported title executable. The modal now binds action handlers
   through DOM properties with no data in executable source.
3. **Imported year fields could inject markup.** Four list/carousel/Tonight
   render points emitted `year` without HTML escaping. All now use the existing
   escaping helper.
4. **Unsafe imported external links were clickable.** `kp_url` could contain a
   `javascript:` scheme. External Kinopoisk links now pass an HTTP/HTTPS allowlist
   and unsafe values are omitted.

Each fix has a headless-browser regression that failed before the fix.

## Verified subsystems

- **Data safety:** startup parsing, shape normalization without startup writes,
  `watchlist_v3` preservation across Auth/reload tests, backup survival, import
  and cloud-pull snapshots, duplicate TMDB identity handling, Tonight refinement,
  and playback-progress normalization/limits.
- **Auth/recovery:** sign-in and sign-up handlers, localized errors, recovery
  request anti-enumeration, valid/missing/retryable callbacks, sessionStorage-only
  recovery state, TTL/cancel, sync isolation, password validation, fresh-login
  success/failure, different-user choice, and normal callback separation.
- **Routing:** Home/List/Search/Profile, direct library detail, invalid route,
  Back/Forward, dead recovery route, and compatibility redirect query/hash.
- **PWA:** canonical marker/manifest identity, stale-shell build-marker guard,
  GET-only same-origin cache handling, and no Supabase Auth interception.
- **Local server:** canonical public entries, marker/no-store headers, and
  rejection of hidden, nested, traversal, `.git`, `.env`, tools, and docs paths.
- **TMDB:** movie/TV identity distinction and duplicate prevention are exercised;
  production search/details are mocked to prevent external calls.
- **Player/progress:** adaptive short-media threshold, 95% completion boundary,
  Continue Watching ordering, progress payload normalization, and source/token
  exclusion were reviewed. Player teardown removes listeners, timers, media, and
  local-file object URLs.
- **UI:** a 390 px overflow smoke test and keyboard focusability of primary
  navigation/actions run in Chromium.

## Automated coverage and CI

`npm test` runs 43 checks:

- 10 Node static/source tests;
- 3 Python local-server security tests;
- 30 isolated Playwright browser checks using an installed Chromium-family
  browser.

The GitHub Actions workflow runs on pull requests and main pushes with read-only
repository permission, a 15-minute timeout, exact `playwright-core` 1.62.1,
syntax/whitespace checks, tracked-file secret-pattern checks, and the complete
suite. No workflow secret or deployment permission is used.

See [TESTING.md](TESTING.md) for commands and isolation guarantees.

## Data-safety and security conclusions

- The audit does not change the storage or backup schema and performs no eager
  migration. `watchlist_v3`, ratings, notes, favorites, watched items, Tonight,
  TMDB metadata, and playback progress retain their existing keys.
- Recovery state stays in `sessionStorage`; Auth/recovery tokens are not part of
  state or backup. The canonical cloud payload strips TMDB token fields and
  transient UI state.
- The Supabase publishable key remains public by design. No service-role key,
  JWT, private key, `.env`, password, or real credential was added.
- Cloud overwrite remains an explicit user choice with a pre-pull undo snapshot
  and revision conflict handling. Tests make no production Auth or database
  mutation.

## Risks intentionally left unchanged

- `index.html` remains a large single-file application. Splitting it into modules
  would be a broad architectural refactor, not a stability fix.
- Real Supabase/TMDB availability, rate limits, RLS, and email delivery cannot be
  proven by mock-only CI. Those paths retain existing user confirmation and error
  handling.
- Remote video playback still depends on provider CORS, browser codecs, and HLS
  behavior. The test suite does not introduce media sources or transcoding.
- Poster/CSS background URLs can fail or be blocked by a browser; this is treated
  as a display failure, not executable content.
- Service-worker source invariants are automated, but a full upgrade/offline
  lifecycle remains a browser/device acceptance check.

## Manual checks still required

- Physical iPhone Safari and installed-PWA upgrade/offline behavior.
- Physical TV remote focus, Back, fullscreen, and long-session player teardown.
- Real MP4/WebM/HLS and local MOV/HEVC playback on supported devices.
- Authenticated TMDB Edge search/movie/TV/season details.
- Supabase sign-in/sign-up, manual sync on two devices, and recovery email flow
  with a dedicated test account. Never use the owner's password for acceptance.

## Rollback

This hardening has no data migration. Revert its commits in reverse order to
return code and tests to the preceding main state. If the root PWA itself must be
rolled back, retain and follow the existing root-rollout ADR and rollback tag;
do not delete browser storage, IndexedDB, or user backups.
