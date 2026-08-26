# ADR-001: Player stack for Beta 15

- Status: accepted for PR1 foundation
- Date: 2026-08-25

## Context

Beta 15 needs an internal player that works in its existing vanilla, single-file application and can later accept streams from user URLs, files, legal providers, or a Home Engine companion. The media implementation must remain replaceable without migrating watchlist or future playback-progress data. Mouse, touch, keyboard, and TV remote are equal target inputs.

Phase 0 compared Vidstack, Media Chrome with hls.js, native video with hls.js, Shaka Player, and Lampa as an architectural reference. Small isolated prototypes covered MP4, HLS, tracks, teardown, and keyboard behaviour in Chromium. Lampa's separation of source selection, playback backend, player view, and TV navigation is useful, but no GPL code, CSS, or components are copied.

## Decision

Use Vidstack `1.15.6` Default Video Layout as the media backend and standard controls. Load only exact, immutable CDN versions. Override Vidstack's default HLS loader with hls.js `1.7.1`; preview tags, version ranges, and unversioned CDN URLs are not allowed.

Application code owns three backend-neutral contracts:

- `PlaybackTarget`: the movie or concrete episode being played.
- `PlaybackSourceRef`: an ephemeral request for a resolver such as user URL, local file, Home Engine, or provider.
- `ResolvedPlaybackSource`: the runtime media URL/type and optional teardown callback supplied to `MediaBackend`.

`VidstackMediaBackend` owns create, attach, and idempotent destroy. Resolver and backend state stay in memory and raw URLs, credentials, and Blob URLs are not written to `watchlist_v3`, backup, or cloud sync. Future playback progress will key off `PlaybackTarget`, not the backend or source URL.

The `local-file` resolver accepts MOV/QuickTime and other local `video/*` files instead of limiting selection to MP4/WebM. It passes a temporary Blob/Object URL to the browser's native video pipeline, reports unsupported containers or codecs in Russian, and always revokes the Object URL during teardown. Client-side transcoding is intentionally out of scope; HLS remains a separate URL resolver.

The isolated native local-file path passes the original `File` directly to `URL.createObjectURL`, assigns the resulting URL once to native `video.src`, calls `load()` once, and retains the video and Object URL until explicit teardown/source change. A `NotAllowedError` caused by autoplay policy must leave a successfully loaded video paused and playable by explicit user action; only actual source/decode failures are reported as media errors. Neither the selected file nor its Blob URL is persisted or logged.

Because iPhone Safari's native local-video controls impose their own ten-second seek step, the direct `<video>` keeps native decoding but uses compact application-owned Russian overlay controls with an exact five-second step. Mobile transport uses icon-only play/pause, `↶ 5` / `5 ↷`, a bottom seek/time row, compact mute and fullscreen controls; the system-controlled iOS volume slider is hidden while mute remains available. Touch can reveal or hide controls and playback auto-hides them, while desktop and TV retain larger, focus-visible targets.

Fullscreen behaviour is platform-specific by design. In a normal Safari browser tab, Player uses the maximum available theater/CSS mode with the custom controls and accepts that Safari browser chrome remains visible; no browser-chrome workaround is attempted. In standalone PWA mode, Player fills the complete `100dvh` viewport, respects safe-area insets, and therefore runs without browser chrome. Native `<video>` fullscreen is not the primary mode because Safari replaces the application controls and restores its native ten-second seek UI. Container Fullscreen API remains preferred where supported, with the CSS theater mode as the safe fallback.

Vidstack's accessible controls remain the baseline. The application adds a deliberately small TV controller for D-pad focus, play/pause, seek, volume, fullscreen, and Back priority because Phase 0 found that browser/player defaults alone do not provide consistent remote navigation.

All application-owned player controls, labels, status messages, errors, retry actions, and fullscreen affordances are localized in Russian. Native media controls owned by Safari or another browser are not overridden. Seeking uses a single five-second step everywhere: `−5 сек` backward and `+5 сек` forward in layout actions, keyboard shortcuts, and TV/D-pad handling.

## Alternatives

- Media Chrome plus hls.js: composable and standards-oriented, but requires more control assembly and TV focus work for this single-file application.
- Native video plus hls.js: smallest dependency surface, but would require building and maintaining the complete controls, accessibility, tracks, errors, and fullscreen UX.
- Shaka Player: strong streaming and DRM capabilities, but excessive weight and complexity for the MP4/WebM/HLS foundation.
- Lampa: valuable UX and source/backend separation reference, but GPL licensing prevents copying its implementation without a separate licensing decision.

## Consequences

- The player can later swap Vidstack for another `MediaBackend` without changing source resolvers or playback state.
- Home Engine and provider resolvers are explicit stubs in PR1. Future zero-config discovery and pairing can return the same runtime `ResolvedPlaybackSource`; raw stream URLs and credentials must not be stored in cloud state.
- CDN availability is a runtime dependency, so the application must surface load failures and keep navigation usable.
- PR1 intentionally excludes playback progress, Continue Watching, automatic watched state, Home Engine, provider integrations, and Supabase changes.
