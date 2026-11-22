const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

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
  assert.match(html, /SYNC_FORBIDDEN_KEYS=.*tmdbToken.*watchlist_tmdb_key.*access_token.*refresh_token/);
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

test('tracked text files contain no obvious committed secret values', () => {
  const names = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
  const textExtensions = new Set(['.html', '.js', '.cjs', '.ts', '.json', '.md', '.py', '.yml', '.yaml', '.bat', '.webmanifest']);
  for (const name of names.filter(name => textExtensions.has(path.extname(name)))) {
    const source = read(name);
    assert.doesNotMatch(source, /sb_secret_[A-Za-z0-9_-]{16,}/, `${name} contains a Supabase secret key`);
    assert.doesNotMatch(source, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, `${name} contains a JWT-like token`);
    assert.doesNotMatch(source, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, `${name} contains a private key`);
  }
});

test('browser harness uses a pinned public dependency without Codex runtime paths', () => {
  const pkg = JSON.parse(read('package.json')), harness = read('tests/browser-regression.cjs');
  assert.equal(pkg.devDependencies['playwright-core'], '1.62.1');
  assert.doesNotMatch(harness, /codex-runtimes|NODE_PATH|\.cache[\\/]codex/i);
});

test('automatic sync has one rollback switch and explicit critical mutation origins', () => {
  assert.match(html, /const AUTO_SYNC_V1_ENABLED=/);
  assert.match(html, /SYNC_ORIGINS=Object\.freeze\([\s\S]*CONFLICT:'conflict-resolution'/);
  assert.match(html, /saveState\(\{origin:SYNC_ORIGINS\.CLOUD,reason:'cloud-pull'\}\)/);
  assert.match(html, /saveState\(\{origin:SYNC_ORIGINS\.PLAYBACK,reason:'playback-progress'\}\)/);
  assert.match(html, /saveState\(\{origin:SYNC_ORIGINS\.IMPORT,reason:`backup-\$\{mode\}`\}\)/);
  assert.match(html, /saveState\(\{origin:SYNC_ORIGINS\.UNDO_CLOUD,reason:'undo-cloud-pull'\}\)/);
  assert.match(html, /saveState\(\{origin:SYNC_ORIGINS\.TAB,reason:'storage-safe-merge'\}\)/);
  assert.match(html, /saveState\(\{origin:SYNC_ORIGINS\.CONFLICT,reason:'automatic-safe-merge'\}\)/);
});

test('sync writes user state before optional metadata and excludes sensitive fields', () => {
  const save = html.match(/function saveState\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(save.indexOf('localStorage.setItem(STORAGE_KEY') >= 0);
  assert.ok(save.indexOf('localStorage.setItem(STORAGE_KEY') < save.indexOf('markCloudDirty'));
  assert.match(html, /SYNC_FORBIDDEN_KEYS=.*tmdbToken.*watchlist_tmdb_key.*access_token.*refresh_token/);
  assert.doesNotMatch(html, /canonicalSyncState[\s\S]{0,500}(?:access_token|refresh_token|sourceUrl|blob:)/);
});

test('auto sync uses revision CAS, foreground polling, lease and recovery isolation', () => {
  assert.match(html, /p_expected_revision:Number\(expectedRevision\)\|\|0/);
  assert.match(html, /document\.visibilityState==='visible'/);
  assert.match(html, /AUTO_SYNC_POLL_MS=60000/);
  assert.match(html, /AUTO_SYNC_RETRY_STEPS=.*\[5000,15000,30000,60000,300000\]/);
  assert.match(html, /CLOUD_LEASE_KEY='watchlist_supabase_sync_lease'/);
  assert.match(html, /if\(loadCloudRecoverySession\(\)\)\{if\(manual\)openCloudPasswordRecovery\(\);return false\}/);
  assert.doesNotMatch(html, /BroadcastChannel|postgres_changes|realtime\.channel/);
});
