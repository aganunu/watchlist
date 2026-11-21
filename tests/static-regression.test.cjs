const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const sw = read('sw.js');
const redirect = read('v6-beta15.html');
const manifest = JSON.parse(read('manifest.webmanifest'));

test('canonical shell contains the Beta 15 build marker and valid JavaScript', () => {
  assert.match(html, /name="watchlist-build"\s+content="beta15-pwa-1"/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'inline application script is present');
  assert.doesNotThrow(() => new Function(script[1]));
});

test('manifest keeps the installed PWA identity', () => {
  assert.equal(manifest.id, './?appv=563');
  assert.equal(manifest.start_url, './?appv=563');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
});

test('service worker validates the canonical shell before caching it', () => {
  assert.match(sw, /const CACHE = 'watchlist-beta15-pwa-1'/);
  assert.match(sw, /const BUILD_MARKER = 'beta15-pwa-1'/);
  assert.match(sw, /responseHasCurrentBuild\(canonical\)/);
  assert.match(sw, /throw new Error\(`Canonical shell is missing build marker/);
  assert.match(sw, /response\.ok && isCanonical && await responseHasCurrentBuild\(response\)/);
});

test('service worker never handles Auth writes or arbitrary cross-origin traffic', () => {
  assert.match(sw, /if \(request\.method !== 'GET'\) return/);
  assert.match(sw, /if \(url\.origin !== self\.location\.origin \|\| !STATIC_PATHS\.has\(url\.pathname\)\) return/);
  assert.doesNotMatch(sw, /supabase\.co|auth\/v1|rest\/v1/);
});

test('compatibility entry preserves query and hash with location.replace', () => {
  assert.match(redirect, /target\.search = location\.search/);
  assert.match(redirect, /target\.hash = location\.hash/);
  assert.match(redirect, /location\.replace\(target\.href\)/);
  assert.doesNotMatch(redirect, /watchlist_v3|localStorage|sessionStorage/);
});

test('recovery state is isolated from localStorage and cloud payload', () => {
  assert.match(html, /sessionStorage\.setItem\(CLOUD_RECOVERY_SESSION_KEY/);
  assert.doesNotMatch(html, /localStorage\.setItem\(CLOUD_RECOVERY_SESSION_KEY/);
  assert.match(html, /delete payload\.tmdbToken;delete payload\.tmdb_token;delete payload\.watchlist_tmdb_key/);
  assert.match(html, /if\(loadCloudRecoverySession\(\)\)\{openCloudPasswordRecovery\(\);return\}/);
});

test('invalid recovery routes are replaced with canonical Home', () => {
  assert.match(html, /function canonicalizeInvalidRecoveryRoute\(\)\{[\s\S]*?writeAppRoute\('#home',\{replace:true,force:true\}\)/);
  assert.match(html, /route\.view==='recovery'&&!recovery[\s\S]*?canonicalizeInvalidRecoveryRoute\(\)/);
});

test('repository contains no service-role key or committed environment file', () => {
  const files = fs.readdirSync(root, {withFileTypes: true});
  assert.equal(files.some(entry => entry.name === '.env' || entry.name.startsWith('.env.')), false);
  for (const name of ['index.html', 'sw.js', 'supabase/functions/tmdb/index.ts']) {
    assert.doesNotMatch(read(name).toLowerCase(), /service[_-]?role|supabase_service/);
  }
});
