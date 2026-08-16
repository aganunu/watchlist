# Watchlist project instructions

## Project
- Personal movie/series web app.
- Current development version: `v6-beta15.html`.
- Preserve existing user data and backward compatibility.

## Local development
- Use the existing local server: `http://127.0.0.1:8765/`
- Keep port `8765` stable.
- Do not use `file://` for testing.
- Do not clear or reset localStorage unless explicitly requested.
- Main storage key: `watchlist_v3`.
- TMDB token key: `watchlist_tmdb_key`.

## Git workflow
- Before editing, check the current branch and `git status`.
- Work on the current task branch unless explicitly told otherwise.
- Do not commit, push, create PRs, merge, switch branches, or modify `main` unless explicitly requested.
- Never include user backups, tokens, browser data, or temporary test files in Git.

## Development rules
- Prefer small changes over broad refactors.
- Reuse existing functions instead of duplicating logic.
- Preserve mobile, desktop, and TV/large-screen behavior; all three are required target platforms.
- UI navigation must be mouse-, touch-, keyboard-, and TV/remote-friendly, with visible focus and no hover-only actions.
- Do not change unrelated features.
- Do not remove user data or existing functionality without explicit approval.

## Validation
For code changes:
- Check JavaScript syntax.
- Run `git diff --check`.
- Check browser console for errors.

For UI changes:
- Test desktop, mobile, and TV/large-screen layouts.
- Test keyboard/remote navigation, visible focus, and verify that no action is available only on hover.
- Check for horizontal overflow.
- Test the changed user scenario.

## Response style
- Do the task instead of describing a long plan first.
- Keep the final report concise: changed files, what changed, tests, and any problem found.
- Do not repeat project history or these instructions in the final report.
