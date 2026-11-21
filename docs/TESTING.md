# Testing Beta 15

## Prerequisites

- Node.js 24 (the source checks also work on current supported Node releases);
- Python 3.13;
- Chrome, Chromium, or Edge already installed.

Install the single pinned development dependency:

```sh
npm install --ignore-scripts --no-audit --no-fund
```

`playwright-core` is pinned to 1.62.1 and does not download a browser. The test
harness finds an installed Chrome/Chromium/Edge through standard executable
locations or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. It contains no Codex-runtime
paths.

## Commands

Run everything:

```sh
npm test
```

Run source and local-server tests only:

```sh
npm run test:static
```

Run browser checks only:

```sh
npm run test:browser
```

Final repository checks:

```sh
node --check sw.js
node --check tests/static-regression.test.cjs
node --check tests/browser-regression.cjs
python -m py_compile tools/serve_local.py tests/test_local_server.py
git diff --check main...HEAD
```

## Isolation and safety

Browser tests use a temporary loopback origin and a new browser context for each
case. All external requests are intercepted: fixed base data and CDN modules are
fulfilled locally, Supabase endpoints return mock responses, and every other
cross-origin request is aborted. Service workers are blocked in these contexts.

The suite never uses production credentials, sends email, changes a password,
uploads state, or clears the user's browser storage. Fixtures exist only in the
temporary browser contexts and are discarded after each case.

The Python server tests bind to a random loopback port rather than port 8765, so
they do not stop or alter the user's existing Watchlist server.
