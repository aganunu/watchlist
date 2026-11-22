# ADR-004: Safe Auto Sync v1

## Status

Accepted for Beta 15.

## Decision

Keep the existing `watchlist_v3` whole-state snapshot and the existing Supabase
`watchlist_state` row. Automatic synchronization uses the existing
`save_watchlist_state` revision compare-and-swap RPC; no database, RLS, RPC,
Edge Function, or service-worker change is required.

`watchlist_v3` is always written before optional sync metadata. The local sync
metadata records the last common revision, canonical digests, and (when quota
allows) the last common snapshot. Failure to persist metadata must never roll
back or prevent a user-state write. Without a trustworthy baseline the client
falls back to the manual synchronization UI.

## Mutation origins

Every state write has one explicit origin:

- `local-user` and `import` mark the state dirty and use a two-second trailing
  debounce;
- `playback` keeps the existing local persistence cadence and limits cloud
  writes to roughly once per 30 seconds;
- `undo-cloud` is a local mutation against the current cloud revision;
- `cloud-applied`, `tab-applied`, and `startup-normalization` never schedule a
  cloud write;
- `conflict-resolution` performs one controlled CAS and never enters the
  ordinary debounce scheduler.

Unknown future `saveState()` call sites default to `local-user` so a mutation is
not silently omitted from synchronization.

## Conflict policy

When local and cloud both changed, a three-way resolver compares them with the
last common snapshot. It automatically merges only changes proven independent:
one unchanged side, identical results, distinct known keys, or newer playback
progress for one stable target. Different edits of the same value,
delete-versus-edit, unknown fields changed on both sides, or an unavailable
rollback snapshot require explicit user choice.

A revision mismatch never causes an automatic pull over local state. The local
candidate remains intact, the latest cloud row is fetched, and automatic pushes
stop until a safe merge or explicit resolution succeeds.

## Scheduling and multi-tab behavior

Foreground clients check at login/startup, reconnect, visibility restore, and
approximately once per minute while authenticated, online, visible, and outside
password recovery. Retry uses bounded backoff. Logout and recovery stop every
timer and release the short-lived per-tab localStorage lease.

Storage events apply another tab's state only when the receiving tab is clean.
A divergent tab uses the same three-way resolver; overlapping changes become a
local conflict rather than last-write-wins. BroadcastChannel and Supabase
Realtime are intentionally outside v1.

## Security and rollback

TMDB tokens, Auth/recovery tokens, playback source URLs, Blob/File paths,
credentials, and transient UI fields are excluded from cloud payloads and sync
snapshots. `AUTO_SYNC_V1_ENABLED` is the emergency rollback switch: disabling it
stops background polling, retry, and auto-push while preserving manual sync and
all user data.
