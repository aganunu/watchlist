# ADR-003: Supabase password recovery

## Status

Accepted for the Beta 15 password-recovery rollout.

## Decision

- Password recovery uses the existing raw Supabase Auth transport and the public publishable key. `supabase-js`, service-role keys, database changes, and Edge Functions are not introduced.
- The production recovery redirect is exactly `https://aganunu.github.io/watchlist/`. The hosted Supabase project uses that URL for both **Site URL** and the exact **Additional Redirect URL**. Localhost, `127.0.0.1`, and LAN HTTP addresses are not production redirects.
- The recovery email is requested with `POST /auth/v1/recover?redirect_to=...` and body `{email}`. The UI always returns an enumeration-safe success message.
- Auth callbacks are parsed before application routes. `type=recovery` is handled before normal login/signup callbacks and never writes its tokens to `watchlist_supabase_session`.
- A validated recovery session is stored only in `sessionStorage` under `watchlist_supabase_recovery_session`. It includes the Supabase session, user ID, and `startedAt`, expires locally after 30 minutes, and is removed on success, cancellation, invalid/expired state, user mismatch, or completion.
- The internal `#recovery` route is valid only while that recovery session is valid. Sensitive callback parameters are removed only after server-side validation succeeds; retryable network failures retain the callback so the user can retry.

## Password update and account selection

- Password update uses authenticated `PUT /auth/v1/user` with `{password}` and the recovery access token.
- A successful update is followed by a fresh password grant using `POST /auth/v1/token?grant_type=password`. The plaintext password is discarded immediately after that request finishes.
- Recovery tokens are never promoted to the normal cloud session. Only the fresh password-grant session can be passed to the existing `storeCloudSession()` path.
- If the password update succeeds but the fresh sign-in fails, recovery is still considered complete and the user is told to sign in with the new password.
- If there was no normal session, the fresh session becomes the normal session. A fresh session for the same user replaces the previous one. A different-user conflict requires an explicit choice between switching to the recovered account and retaining the current account.
- Cloud upload, download, first-sync, and manual sync remain blocked until recovery and any different-user choice are complete. No state is merged automatically.

## Data and security boundaries

- Recovery state never enters `watchlist_v3`, backup files, cloud snapshots, sync checksums, or TMDB settings.
- Passwords, email addresses, and access/refresh tokens are not logged. Known Auth errors are translated into generic Russian UI messages.
- The existing service worker remains unchanged: it ignores non-GET requests and arbitrary cross-origin requests, so Supabase Auth traffic is neither intercepted nor cached. Its canonical offline fallback may load the recovery UI, but network validation must succeed before callback secrets are removed.
- Safari and an installed iOS PWA may use separate storage containers. The flow completes in whichever context opens the recovery link; the PWA can then sign in with the new password.

## Rollout and rollback

1. Configure the production Site URL and exact redirect allowlist before live recovery testing; verify that the recovery email template uses `{{ .ConfirmationURL }}` and contains no localhost URL.
2. Validate request privacy, callback priority, expiry, reload, cancellation, password policies, fresh sign-in, account conflicts, sync isolation, routing, mobile, desktop, and TV focus behavior.
3. Perform the real password change manually without exposing credentials to logs, screenshots, or automation.
4. Roll back by reverting the feature commit. The separate session-storage entry is ignored by older code and disappears with the browser session; no user data or schema rollback is required. Keep the production Site URL rather than restoring localhost.
