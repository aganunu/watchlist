# ADR-002: Beta 15 as the canonical PWA root

## Status

Accepted for the first Beta 15 root rollout.

## Decision

- `index.html` is the only complete application document and the canonical entry point for GitHub Pages, browser use, local development, and the installed PWA.
- `v6-beta15.html` is a small same-origin compatibility redirect to `./` that preserves `location.search` and `location.hash`. Old bookmarks, detail routes, and Supabase Auth callbacks therefore reach the canonical application without keeping a second implementation.
- Existing browser storage is retained in place. The rollout does not clear or migrate `watchlist_v3`, `watchlist_tmdb_key`, Supabase session metadata, device identifiers, import undo snapshots, IndexedDB, or other user data.
- The installed PWA keeps its identity: manifest `id` and `start_url` remain `./?appv=563`, scope remains `./`, and the existing name and icons are retained.

## Service worker and cache policy

- The rollout build marker is `beta15-pwa-1`; its application cache is `watchlist-beta15-pwa-1`.
- The canonical offline shell is written only after its `watchlist-build` meta marker matches the current build; a stale CDN response fails worker installation instead of replacing a valid shell.
- Each behavior-changing service-worker release must use a new build marker and cache name. A rollback is also a new forward release with a new cache name; an old cache name must not be reused.
- Installation fetches the canonical application shell, manifest, and icons freshly. The two immutable, commit-pinned base-list URLs may be cached best-effort, but their failure never blocks installation or activation.
- Activation claims clients and deletes older application caches whose names start with `watchlist-`, including `watchlist-v5-6-3`, while leaving Local Storage and IndexedDB untouched.
- Navigations and same-origin static assets are network-first. The only navigation fallback is the cached canonical `index.html`; a response from `v6-beta15.html` is never stored as that fallback.
- Cross-origin requests are ignored by the service worker except for the two exact pinned base-list URLs. Supabase, TMDB, media, HLS, Blob/File, and arbitrary third-party traffic are never intercepted or cached by it.

## Local development

- The stable local origin remains `http://127.0.0.1:8765/`, with the LAN equivalent printed by the launcher.
- The allowlisted server serves `/` as `index.html`, keeps `v6-beta15.html` available for compatibility testing, and continues to reject `.git`, `.env`, `tools`, hidden paths, nested paths, and arbitrary repository files.

## Rollout and rollback

1. Verify storage-key presence before and after the upgrade without reading or printing secret values.
2. Verify that an isolated client controlled by the legacy worker upgrades to the new worker, deletes `watchlist-v5-6-3`, and receives the Beta 15 canonical shell offline.
3. Roll out through the normal pull-request process after desktop, mobile, standalone-PWA, TV, Player, routing, Continue Watching, and Supabase smoke tests.
4. If rollback is required, revert the canonical document changes in a new commit and publish a service worker with a new rollback cache version so installed clients cannot remain pinned to the faulty shell.

No release tag is created for the initial task branch.
