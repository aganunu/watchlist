const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const BUILD_MARKER = 'beta15-pwa-1';
const RECOVERY_KEY = 'watchlist_supabase_recovery_session';
const SESSION_KEY = 'watchlist_supabase_session';
const STATE_KEY = 'watchlist_v3';
const TOKEN_KEY = 'watchlist_tmdb_key';
const SYNC_KEY = 'watchlist_supabase_sync';
const CONFLICT_KEY = 'watchlist_supabase_conflict';
const SUPABASE_HOST = 'owiqnzkavzjqbckstegc.supabase.co';
const BASE = {
  movies: [{title: 'Тестовый фильм', year: 2024, type: 'M', rating: 8.2, desc: 'Описание фильма', genres: ['Драма']}],
  series: [{title: 'Тестовый сериал', year: 2023, type: 'S', rating: 8.7, desc: 'Описание сериала', genres: ['Драма']}],
};
const BASE_DOCUMENT = `const DATA = ${JSON.stringify(BASE)};\nconst GENRE_COLORS = {};`;
const STATE_FIXTURE = {
  watched: [], pins: [], addedItems: [], tmdbMeta: {}, ratings: {}, notes: {},
  playbackProgress: {}, identities: {}, identityHistory: [], titleAliases: {},
};
const SYNC_STATE_FIXTURE = {
  watched: [], pins: [], addedItems: [], identityHistory: [], batchHistory: [], tmdbAuditLog: [], tmdbUpdateHistory: [], tmdbReviewSkipped: [], tmdbUnresolved: [],
  tmdbMeta: {}, ratings: {}, notes: {}, identities: {}, titleAliases: {}, playbackProgress: {},
  manualReviewQueue: {ids: [], total: 0, completed: 0, skipped: 0, createdAt: null}, lastBatchUndo: null,
};
const USERS = {
  recovered: {id: 'user-recovered', email: 'recovered@example.test'},
  existing: {id: 'user-existing', email: 'existing@example.test'},
  normal: {id: 'user-normal', email: 'normal@example.test'},
};

function browserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error('Chromium/Chrome/Edge executable not found');
  return executable;
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.webmanifest')) return 'application/manifest+json; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function createServer() {
  const allowed = new Set(['index.html', 'v6-beta15.html', 'manifest.webmanifest', 'sw.js', 'icon-180.png', 'icon-512.png']);
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (!allowed.has(name) || name.includes('/') || name.startsWith('.')) {
      response.writeHead(404, {'Cache-Control': 'no-store'});response.end('Not found');return;
    }
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) {response.writeHead(404);response.end('Not found');return;}
    response.writeHead(200, {'Content-Type': contentType(file), 'Cache-Control': 'no-store'});
    response.end(fs.readFileSync(file));
  });
}

function session(user, prefix = 'fresh') {
  return {access_token: `${prefix}-access`, refresh_token: `${prefix}-refresh`, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user};
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function digest(value) {
  const text = stableSerialize(value);let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function syncMeta(base, revision = 1, userId = USERS.normal.id) {
  const value = JSON.parse(JSON.stringify(base)), valueDigest = digest(value);
  return {version:2,userId,deviceId:'fixture-device',revision,baseRevision:revision,localDigest:valueDigest,baseDigest:valueDigest,cloudDigest:valueDigest,baseSnapshot:value,dirty:false,lastSyncedAt:new Date().toISOString()};
}

async function main() {
  const server = createServer();
  await new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve)});
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless: true, executablePath: browserExecutable()});
  let passed = 0;

  async function run(name, body) {
    try {await body();passed += 1;console.log(`PASS ${passed}: ${name}`)}
    catch (error) {error.message = `${name}: ${error.message}`;throw error}
  }

  async function openApp({pathName = '/', viewport = {width: 1280, height: 720}, stateRaw = JSON.stringify(STATE_FIXTURE), normalSession = null, recoverySession = null, backupValue = null, syncMetaValue = null, cloudRecord = null, sync = {}, auth = {}, autoSync = true, playbackSyncMs = null, retrySteps = null} = {}) {
    const counters = {recover: 0, signup: 0, update: 0, passwordGrant: 0, refresh: 0, rest: 0, rpc: 0, logout: 0, rpcBodies: []};
    const cloud = {record: cloudRecord ? JSON.parse(JSON.stringify(cloudRecord)) : null};
    const context = await browser.newContext({viewport, serviceWorkers: 'block'});
    await context.addInitScript(config => {
      if (location.origin !== config.origin) return;
      globalThis.__WATCHLIST_AUTO_SYNC_V1_ENABLED__ = config.autoSync;
      if (config.playbackSyncMs) globalThis.__WATCHLIST_AUTO_SYNC_PLAYBACK_MS__ = config.playbackSyncMs;
      if (config.retrySteps) globalThis.__WATCHLIST_AUTO_SYNC_RETRY_STEPS__ = config.retrySteps;
      if (config.stateRaw !== null) localStorage.setItem(config.stateKey, config.stateRaw);
      localStorage.setItem(config.tokenKey, 'fixture-tmdb-token');
      if (config.normalSession) localStorage.setItem(config.sessionKey, JSON.stringify(config.normalSession));
      if (config.recoverySession) sessionStorage.setItem(config.recoveryKey, JSON.stringify(config.recoverySession));
      if (config.syncMetaValue) localStorage.setItem(config.syncKey, JSON.stringify(config.syncMetaValue));
      if (config.backupValue !== null) localStorage.setItem('fixture_backup', config.backupValue);
      if (config.syncQuotaFail || config.conflictQuotaFail) {const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(config.syncQuotaFail&&key===config.syncKey||config.conflictQuotaFail&&key===config.conflictKey)throw new DOMException('quota','QuotaExceededError');return original.call(this,key,value)}}
    }, {origin, stateRaw, stateKey: STATE_KEY, tokenKey: TOKEN_KEY, sessionKey: SESSION_KEY, recoveryKey: RECOVERY_KEY, syncKey: SYNC_KEY, conflictKey: CONFLICT_KEY, normalSession, recoverySession, syncMetaValue, backupValue, syncQuotaFail:!!sync.quotaFail, conflictQuotaFail:!!sync.conflictQuotaFail, autoSync, playbackSyncMs, retrySteps});
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'raw.githubusercontent.com' || url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/aganunu/watchlist@')) {
        await route.fulfill({status: 200, contentType: 'text/plain', body: BASE_DOCUMENT});return;
      }
      if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/vidstack@1.15.6/')) {
        const css = url.pathname.endsWith('.css');await route.fulfill({status: 200, contentType: css ? 'text/css' : 'text/javascript', body: ''});return;
      }
      if (url.hostname === SUPABASE_HOST) {
        const request = route.request(), method = request.method(), pathname = url.pathname;
        const json = (status, body) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
        if (pathname === '/auth/v1/recover') {counters.recover += 1;if (auth.recoverNetwork) {await route.abort();return;}await json(auth.recoverStatus || 200, auth.recoverStatus ? {message: 'mock failure'} : {});return;}
        if (pathname === '/auth/v1/signup') {counters.signup += 1;await json(auth.signupStatus || 200, auth.signupStatus ? {message: 'mock signup failure'} : session(USERS.normal, 'signup'));return;}
        if (pathname === '/auth/v1/user' && method === 'GET') {
          const token = (request.headers().authorization || '').replace(/^Bearer\s+/i, '');
          const user = token.startsWith('recovery-') ? USERS.recovered : USERS.normal;
          await json(auth.userStatus || 200, auth.userStatus ? {message: 'invalid token'} : user);return;
        }
        if (pathname === '/auth/v1/user' && method === 'PUT') {counters.update += 1;await json(auth.updateStatus || 200, auth.updateStatus ? {message: 'mock update failure'} : USERS.recovered);return;}
        if (pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
          counters.passwordGrant += 1;
          if (auth.passwordStatus) {await json(auth.passwordStatus, {message: auth.passwordMessage || 'Invalid login credentials'});return;}
          if (auth.freshLoginFails) {await json(503, {message: 'temporary sign-in failure'});return;}
          await json(200, session(USERS.recovered));return;
        }
        if (pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {counters.refresh += 1;if(auth.refreshDelay)await new Promise(resolve=>setTimeout(resolve,auth.refreshDelay));const body=request.postDataJSON(),user=String(body.refresh_token||'').startsWith('recovery-')?USERS.recovered:USERS.normal;await json(200, session(user, 'refreshed'));return;}
        if (pathname === '/auth/v1/logout') {counters.logout += 1;if(auth.logoutDelay)await new Promise(resolve=>setTimeout(resolve,auth.logoutDelay));if(auth.logoutNetwork){await route.abort();return;}await json(200, {});return;}
        if (pathname === '/rest/v1/watchlist_state') {counters.rest += 1;if(sync.restDelay)await new Promise(resolve=>setTimeout(resolve,sync.restDelay));if(sync.readFailures>0){sync.readFailures-=1;await json(503,{message:'temporary read failure'});return;}if(sync.networkFailure){await route.abort();return;}await json(200, cloud.record ? [cloud.record] : []);return;}
        if (pathname === '/rest/v1/rpc/save_watchlist_state') {
          counters.rest += 1;counters.rpc += 1;const body=request.postDataJSON();counters.rpcBodies.push(body);
          if(sync.networkFailure){await route.abort();return;}
          if(sync.forceConflictOnce && counters.rpc===1){if(sync.conflictRecord)cloud.record=JSON.parse(JSON.stringify(sync.conflictRecord));await json(409,{message:'revision_conflict'});return;}
          const currentRevision=cloud.record ? Number(cloud.record.revision)||0 : 0;
          if(Number(body.p_expected_revision)!==currentRevision){await json(409,{message:'revision_conflict'});return;}
          cloud.record={state:body.p_state,revision:currentRevision+1,updated_at:new Date().toISOString(),updated_by:body.p_device_id||null};await json(200,cloud.record);return;
        }
        if (pathname.startsWith('/rest/v1/')) {counters.rest += 1;await json(200, []);return;}
        if (pathname === '/functions/v1/tmdb') {await json(200, {results: []});return;}
        await json(404, {message: 'unmocked Supabase endpoint'});return;
      }
      if (url.origin !== origin) {await route.abort();return;}
      await route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {if (message.type() === 'error') errors.push(message.text())});
    await page.goto(origin + pathName, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => !document.querySelector('#heroCount')?.textContent.includes('Загрузка'), null, {timeout: 10000});
    const close = async ({expectedConsoleErrors = []} = {}) => {
      await page.waitForTimeout(0);
      const captured = [...errors];
      await context.close();
      const unexpected = captured.filter(message => !expectedConsoleErrors.some(pattern => pattern instanceof RegExp ? pattern.test(message) : message.includes(String(pattern))));
      if (unexpected.length) assert.fail(`Unexpected browser console/page errors:\n${unexpected.join('\n')}`);
      return captured;
    };
    return {context, page, errors, counters, cloud, close};
  }

  try {
    await run('app boots with the Beta 15 marker and no JavaScript errors', async () => {
      const app = await openApp();
      assert.equal(await app.page.locator('meta[name="watchlist-build"]').getAttribute('content'), BUILD_MARKER);
      assert.match(await app.page.locator('#heroCount').innerText(), /2 позиц/);
      assert.deepEqual(app.errors, []);await app.close();
    });

    await run('Home, List, Search and Profile render through visible navigation', async () => {
      const app = await openApp();
      for (const view of ['list', 'search', 'profile', 'home']) {
        await app.page.locator(`[data-view="${view}"]:visible`).first().click();
        await app.page.locator(`#view-${view}.active`).waitFor();
        assert.equal(new URL(app.page.url()).hash, `#${view}`);
      }
      await app.close();
    });

    await run('Back and Forward keep URL and active view aligned', async () => {
      const app = await openApp();
      await app.page.locator('[data-view="list"]:visible').first().click();
      await app.page.locator('[data-view="search"]:visible').first().click();
      await app.page.goBack();await app.page.locator('#view-list.active').waitFor();assert.equal(new URL(app.page.url()).hash, '#list');
      await app.page.goForward();await app.page.locator('#view-search.active').waitFor();assert.equal(new URL(app.page.url()).hash, '#search');
      await app.close();
    });

    await run('sign-in form submits once and shows a localized mocked Auth error', async () => {
      const app = await openApp({auth: {passwordStatus: 400}});await app.page.evaluate(() => openCloudAuth());
      await app.page.locator('#cloudEmail').fill('nobody@example.test');await app.page.locator('#cloudPassword').fill('wrong-password');
      await app.page.locator('#cloudSignIn').click();await app.page.getByText('Неверный email или пароль.').waitFor();
      assert.equal(app.counters.passwordGrant, 1);assert.equal(await app.page.evaluate(key => localStorage.getItem(key), SESSION_KEY), null);await app.close({expectedConsoleErrors:[/status of 400/]});
    });

    await run('normal auth starts empty while recovery back preserves explicit email', async () => {
      const app=await openApp();await app.page.evaluate(()=>openCloudAuth());assert.equal(await app.page.locator('#cloudEmail').inputValue(),'');assert.equal(await app.page.locator('#cloudEmail').getAttribute('autocomplete'),'username');assert.equal(await app.page.locator('#cloudPassword').getAttribute('autocomplete'),'current-password');await app.page.evaluate(()=>openCloudRecoveryRequest('return@example.test'));await app.page.locator('#cloudRecoveryBack').click();assert.equal(await app.page.locator('#cloudEmail').inputValue(),'return@example.test');assert.equal(await app.page.locator('#cloudPassword').inputValue(),'');await app.close();
    });

    await run('direct backdrop pointer gesture closes a dismissible modal', async () => {
      const app=await openApp();await app.page.evaluate(()=>openModal('<p>Backdrop test</p>'));await app.page.locator('#modalBg').dispatchEvent('pointerdown',{pointerId:11,pointerType:'mouse',button:0});await app.page.locator('#modalBg').dispatchEvent('pointerup',{pointerId:11,pointerType:'mouse',button:0});assert.equal(await app.page.locator('#modalBg').evaluate(node=>node.classList.contains('hidden')),true);await app.close();
    });

    await run('drag from modal input to backdrop never dismisses the modal', async () => {
      const app=await openApp();await app.page.evaluate(()=>openCloudAuth());await app.page.locator('#cloudEmail').dispatchEvent('pointerdown',{pointerId:12,pointerType:'mouse',button:0});await app.page.locator('#modalBg').dispatchEvent('pointerup',{pointerId:12,pointerType:'mouse',button:0});assert.equal(await app.page.locator('#modalBg').evaluate(node=>node.classList.contains('hidden')),false);await app.close();
    });

    await run('non-dismissible modal ignores backdrop pointer gesture', async () => {
      const app=await openApp();await app.page.evaluate(()=>openModal('<p>Protected</p>',{dismissible:false}));await app.page.locator('#modalBg').dispatchEvent('pointerdown',{pointerId:13,pointerType:'touch',button:0});await app.page.locator('#modalBg').dispatchEvent('pointerup',{pointerId:13,pointerType:'touch',button:0});assert.equal(await app.page.locator('#modalBg').evaluate(node=>node.classList.contains('hidden')),false);await app.page.evaluate(()=>closeModal({force:true,route:false}));await app.close();
    });

    await run('modal close button still dismisses normally', async () => {
      const app=await openApp();await app.page.evaluate(()=>openModal('<p>Close test</p>'));await app.page.locator('#modal .close').click();assert.equal(await app.page.locator('#modalBg').evaluate(node=>node.classList.contains('hidden')),true);await app.close();
    });

    await run('successful sign-in closes auth modal before automatic sync', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),app=await openApp({stateRaw:JSON.stringify(base),syncMetaValue:syncMeta(base,1,USERS.recovered.id),cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},autoSync:true});await app.page.evaluate(()=>openCloudAuth());await app.page.locator('#cloudEmail').fill('user@example.test');await app.page.locator('#cloudPassword').fill('validpass1');await app.page.locator('#cloudSignIn').click();await app.page.waitForFunction(()=>cloudSession&&loadCloudMeta().lastSyncedAt);assert.equal(await app.page.locator('#modalBg').evaluate(node=>node.classList.contains('hidden')),true);assert.equal(await app.page.evaluate(()=>cloudSession.user.id),USERS.recovered.id);assert.equal(app.counters.rpc,0);await app.close();
    });

    await run('successful sign-in closes auth modal before first-sync choice', async () => {
      const local=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),remote=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE));local.notes.local='keep';remote.notes.cloud='keep';const app=await openApp({stateRaw:JSON.stringify(local),cloudRecord:{state:remote,revision:3,updated_at:new Date().toISOString()},autoSync:true});await app.page.evaluate(()=>openCloudAuth());await app.page.locator('#cloudEmail').fill('user@example.test');await app.page.locator('#cloudPassword').fill('validpass1');await app.page.locator('#cloudSignIn').click();await app.page.getByText('☁️ Первая синхронизация').waitFor();assert.equal(await app.page.locator('#cloudAuthForm').count(),0);assert.equal(await app.page.locator('#modalBg').evaluate(node=>node.classList.contains('hidden')),false);assert.equal(app.counters.rpc,0);await app.close();
    });

    await run('sign-up uses the mocked Auth endpoint and stores its returned session', async () => {
      const app = await openApp();await app.page.evaluate(() => openCloudAuth());
      await app.page.locator('#cloudEmail').fill('new@example.test');await app.page.locator('#cloudPassword').fill('validpass1');await app.page.locator('#cloudSignUp').click();
      await app.page.waitForFunction(key => !!localStorage.getItem(key), SESSION_KEY);const stored=JSON.parse(await app.page.evaluate(key => localStorage.getItem(key), SESSION_KEY));
      assert.equal(app.counters.signup,1);assert.equal(stored.access_token,'signup-access');await app.close();
    });

    await run('recovery request is non-enumerating for a mocked unknown account', async () => {
      const app = await openApp({auth:{recoverStatus:404}});await app.page.evaluate(() => openCloudRecoveryRequest());await app.page.locator('#cloudRecoveryEmail').fill('unknown@example.test');await app.page.locator('#cloudRecoverySend').click();
      await app.page.getByText('Письмо отправлено. Если аккаунт существует, ссылка придёт на указанный email.').waitFor();assert.equal(app.counters.recover,1);await app.close({expectedConsoleErrors:[/status of 404/]});
    });

    await run('recovery request surfaces a localized mocked network failure', async () => {
      const app = await openApp({auth:{recoverNetwork:true}});await app.page.evaluate(() => openCloudRecoveryRequest());await app.page.locator('#cloudRecoveryEmail').fill('user@example.test');await app.page.locator('#cloudRecoverySend').click();
      await app.page.getByText(/Не удалось связаться|Сервер не ответил/).waitFor();assert.equal(app.counters.recover,1);await app.close({expectedConsoleErrors:[/ERR_FAILED/]});
    });

    await run('direct library detail route renders the requested item', async () => {
      const id = encodeURIComponent('M::Тестовый фильм::2024'), app = await openApp({pathName: `/#detail/library/${id}`});
      await app.page.locator('#view-detail.active').waitFor();assert.equal(await app.page.locator('#detailTitle').innerText(), 'Тестовый фильм');await app.close();
    });

    await run('invalid route is replaced by canonical Home', async () => {
      const app = await openApp({pathName: '/#not-a-route'});assert.equal(new URL(app.page.url()).hash, '#home');await app.page.locator('#view-home.active').waitFor();await app.close();
    });

    await run('recovery route without a session becomes Home', async () => {
      const app = await openApp({pathName: '/#recovery'});assert.equal(new URL(app.page.url()).hash, '#home');assert.match(await app.page.locator('#modal').innerText(), /Ссылка не подходит/);await app.close();
    });

    await run('valid mocked recovery callback opens recovery UI and uses sessionStorage only', async () => {
      const app = await openApp({pathName: '/#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600&type=recovery'});
      assert.equal(new URL(app.page.url()).hash, '#recovery');assert.match(await app.page.locator('#modal').innerText(), /Новый пароль/);
      const storage = await app.page.evaluate(([key, normal]) => ({recovery: sessionStorage.getItem(key), localRecovery: localStorage.getItem(key), normal: localStorage.getItem(normal)}), [RECOVERY_KEY, SESSION_KEY]);
      assert.ok(storage.recovery);assert.equal(storage.localRecovery, null);assert.equal(storage.normal, null);await app.close();
    });

    await run('recovery callback without refresh token is rejected without promoting a session', async () => {
      const app = await openApp({pathName: '/#access_token=recovery-access&type=recovery'});assert.equal(new URL(app.page.url()).hash,'#home');assert.match(await app.page.locator('#modal').innerText(),/Ссылка не подходит/);
      assert.equal(await app.page.evaluate(key => localStorage.getItem(key), SESSION_KEY),null);assert.equal(await app.page.evaluate(key => sessionStorage.getItem(key), RECOVERY_KEY),null);await app.close();
    });

    await run('retryable recovery callback failure preserves callback URL for retry', async () => {
      const app = await openApp({pathName: '/#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600&type=recovery',auth:{userStatus:503}});
      await app.page.getByText('Не удалось проверить recovery-ссылку').waitFor();assert.match(app.page.url(),/access_token=recovery-access/);assert.equal(await app.page.evaluate(key => localStorage.getItem(key), SESSION_KEY),null);await app.close({expectedConsoleErrors:[/status of 503/]});
    });

    await run('cloud sync stays blocked while recovery is pending', async () => {
      const app = await openApp({pathName: '/#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600&type=recovery'});
      await app.page.evaluate(() => syncCloudNow());assert.equal(app.counters.rest, 0);assert.match(await app.page.locator('#syncCard').innerText(), /Завершите смену пароля/);await app.close();
    });

    await run('expired recovery session is removed and reload canonicalizes Home', async () => {
      const expired = {phase: 'password', session: session(USERS.recovered, 'recovery'), userId: USERS.recovered.id, startedAt: Date.now() - 31 * 60 * 1000, existingUserId: null};
      const app = await openApp({pathName: '/#recovery', recoverySession: expired});assert.equal(new URL(app.page.url()).hash, '#home');assert.equal(await app.page.evaluate(key => sessionStorage.getItem(key), RECOVERY_KEY), null);await app.close();
    });

    await run('TTL expiry while the form is open returns Home before requesting a new link', async () => {
      const app = await openApp({pathName: '/#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600&type=recovery'});
      await app.page.evaluate(key => {const value = JSON.parse(sessionStorage.getItem(key));value.startedAt = Date.now() - 31 * 60 * 1000;sessionStorage.setItem(key, JSON.stringify(value))}, RECOVERY_KEY);
      await app.page.locator('#cloudNewPassword').fill('validpass1');await app.page.locator('#cloudRepeatPassword').fill('validpass1');await app.page.locator('#cloudPasswordSave').click();
      await app.page.locator('#cloudRecoveryRequestForm').waitFor();assert.equal(new URL(app.page.url()).hash, '#home');assert.equal(app.counters.update, 0);await app.close();
    });

    await run('cancel clears recovery state without touching watchlist state', async () => {
      const app = await openApp({pathName: '/#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600&type=recovery'}), before = await app.page.evaluate(key => localStorage.getItem(key), STATE_KEY);
      await app.page.locator('#cloudPasswordCancel').click();await app.page.waitForFunction(() => location.hash === '#home');assert.equal(await app.page.evaluate(key => sessionStorage.getItem(key), RECOVERY_KEY), null);assert.equal(await app.page.evaluate(key => localStorage.getItem(key), STATE_KEY), before);await app.close();
    });

    await run('password mismatch and short password never call Supabase update', async () => {
      const app = await openApp({pathName: '/#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600&type=recovery'});
      await app.page.locator('#cloudNewPassword').fill('short');await app.page.locator('#cloudRepeatPassword').fill('short');await app.page.locator('#cloudPasswordSave').click();assert.match(await app.page.locator('#cloudPasswordRecoveryStatus').innerText(), /не менее 8/);
      await app.page.locator('#cloudNewPassword').fill('validpass1');await app.page.locator('#cloudRepeatPassword').fill('validpass2');await app.page.locator('#cloudPasswordSave').click();assert.match(await app.page.locator('#cloudPasswordRecoveryStatus').innerText(), /не совпадают/);assert.equal(app.counters.update, 0);await app.close();
    });

    await run('successful password update stores only the fresh login session', async () => {
      const app = await openApp({pathName: '/#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600&type=recovery'});
      await app.page.locator('#cloudNewPassword').fill('validpass1');await app.page.locator('#cloudRepeatPassword').fill('validpass1');await app.page.locator('#cloudPasswordSave').click();await app.page.locator('#cloudRecoveryContinueSync').waitFor();
      const stored = JSON.parse(await app.page.evaluate(key => localStorage.getItem(key), SESSION_KEY));assert.equal(stored.access_token, 'fresh-access');assert.equal(await app.page.evaluate(key => sessionStorage.getItem(key), RECOVERY_KEY), null);assert.equal(app.counters.rest, 0);await app.close();
    });

    await run('fresh login failure still completes password recovery safely', async () => {
      const app = await openApp({pathName: '/#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600&type=recovery', auth: {freshLoginFails: true}});
      await app.page.locator('#cloudNewPassword').fill('validpass1');await app.page.locator('#cloudRepeatPassword').fill('validpass1');await app.page.locator('#cloudPasswordSave').click();await app.page.getByText('Пароль изменён. Войдите с новым паролем.').waitFor();
      assert.equal(await app.page.evaluate(key => sessionStorage.getItem(key), RECOVERY_KEY), null);assert.equal(await app.page.evaluate(key => localStorage.getItem(key), SESSION_KEY), null);await app.close({expectedConsoleErrors:[/status of 503/]});
    });

    await run('different-user session conflict requires an explicit choice', async () => {
      const existing = session(USERS.existing, 'existing'), app = await openApp({normalSession: existing, pathName: '/#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600&type=recovery'});
      await app.page.locator('#cloudNewPassword').fill('validpass1');await app.page.locator('#cloudRepeatPassword').fill('validpass1');await app.page.locator('#cloudPasswordSave').click();await app.page.getByText('Выберите аккаунт').waitFor();
      const stored = JSON.parse(await app.page.evaluate(key => localStorage.getItem(key), SESSION_KEY)), recovery = JSON.parse(await app.page.evaluate(key => sessionStorage.getItem(key), RECOVERY_KEY));assert.equal(stored.user.id, USERS.existing.id);assert.equal(recovery.phase, 'account-choice');assert.equal(app.counters.rest, 0);await app.close();
    });

    await run('normal auth callback remains separate from recovery', async () => {
      const app = await openApp({pathName: '/#access_token=normal-access&refresh_token=normal-refresh&expires_in=3600&type=signup'}), stored = JSON.parse(await app.page.evaluate(key => localStorage.getItem(key), SESSION_KEY));
      assert.equal(stored.user.id, USERS.normal.id);assert.equal(await app.page.evaluate(key => sessionStorage.getItem(key), RECOVERY_KEY), null);assert.equal(new URL(app.page.url()).hash, '#home');await app.close();
    });

    await run('auth flows do not mutate watchlist_v3 or the TMDB token', async () => {
      const raw = JSON.stringify(Object.assign({}, STATE_FIXTURE, {notes: {'M::Тестовый фильм::2024': 'не менять'}})), app = await openApp({stateRaw: raw, pathName: '/#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600&type=recovery'});
      await app.page.locator('#cloudPasswordCancel').click();assert.equal(await app.page.evaluate(key => localStorage.getItem(key), STATE_KEY), raw);assert.equal(await app.page.evaluate(key => localStorage.getItem(key), TOKEN_KEY), 'fixture-tmdb-token');await app.close();
    });

    await run('unrelated local backup data survives reload', async () => {
      const app = await openApp({backupValue: '{"fixture":true}'});await app.page.reload();await app.page.waitForFunction(() => !document.querySelector('#heroCount')?.textContent.includes('Загрузка'));assert.equal(await app.page.evaluate(() => localStorage.getItem('fixture_backup')), '{"fixture":true}');await app.close();
    });

    await run('null or malformed watchlist state boots without overwriting stored data', async () => {
      for (const raw of ['null', JSON.stringify({watched:{},pins:'bad',addedItems:{},tmdbMeta:[],ratings:[],notes:[]}), JSON.stringify({addedItems:[null,{title:'Валидная позиция',year:2024,type:'M',genres:{}}],identities:{'M::Тестовый фильм::2024':{aliases:{}}},titleAliases:{'M::Тестовый фильм::2024':{}},tmdbMeta:{broken:'bad'}})]) {
        const app = await openApp({stateRaw: raw});
        assert.doesNotMatch(await app.page.locator('#heroCount').innerText(), /Ошибка загрузки/);
        assert.equal(await app.page.evaluate(key => localStorage.getItem(key), STATE_KEY), raw);
        const shape = await app.page.evaluate(() => ({watched:Array.isArray(state.watched),pins:Array.isArray(state.pins),addedItems:Array.isArray(state.addedItems),tmdbMeta:!!state.tmdbMeta&&!Array.isArray(state.tmdbMeta),ratings:!!state.ratings&&!Array.isArray(state.ratings),notes:!!state.notes&&!Array.isArray(state.notes)}));
        assert.deepEqual(shape, {watched:true,pins:true,addedItems:true,tmdbMeta:true,ratings:true,notes:true});
        assert.equal(await app.page.evaluate(() => items.every(item => typeof searchableText(item)==='string')),true);
        assert.deepEqual(app.errors, []);await app.close();
      }
    });

    await run('imported titles cannot execute inline handlers and unsafe external URLs are omitted', async () => {
      const title = "Карточка');globalThis.__watchlistInjected=true;//";
      const item = {title,year:2024,type:'M',rating:7,desc:'Безопасная проверка',kp_url:'javascript:globalThis.__watchlistInjected=true'};
      const unsafeYear = '2024<img src=x onerror="globalThis.__watchlistYearInjected=true">';
      const raw = JSON.stringify(Object.assign({}, STATE_FIXTURE, {addedItems:[item,{title:'Год из импорта',year:unsafeYear,type:'M',rating:6}]})), id = `M::${title}::2024`;
      const app = await openApp({stateRaw: raw});
      assert.equal(await app.page.evaluate(() => globalThis.__watchlistYearInjected === true), false);
      await app.page.evaluate(value => openDetails(value), id);
      await app.page.locator('#modalFavAction').click();
      assert.equal(await app.page.evaluate(() => globalThis.__watchlistInjected === true), false);
      assert.equal(await app.page.locator('#modal a[href^="javascript:"]').count(), 0);
      await app.close();
    });

    await run('390px layout has no horizontal document overflow', async () => {
      const app = await openApp({viewport: {width: 390, height: 844}}), size = await app.page.evaluate(() => ({inner: innerWidth, scroll: document.documentElement.scrollWidth}));assert.ok(size.scroll <= size.inner + 1, JSON.stringify(size));await app.close();
    });

    await run('major navigation and action buttons are keyboard focusable', async () => {
      const app = await openApp(), result = await app.page.evaluate(() => [...document.querySelectorAll('[data-view],#randomBtn,#addBtn')].filter(element => element.getClientRects().length > 0).map(element => {element.focus();return {tag: element.tagName, focused: document.activeElement === element}}));assert.ok(result.length >= 5);assert.ok(result.every(item => item.tag === 'BUTTON' && item.focused));await app.close();
    });

    await run('playback thresholds, ordering, duplicates and cloud payload invariants hold', async () => {
      const app = await openApp(), values = await app.page.evaluate(() => {
        const now = Date.now();state.playbackProgress = {
          old: {kind:'movie',identityKey:'library:old',libraryId:'M::Тестовый фильм::2024',mediaType:'movie',currentTime:20,duration:100,updatedAt:now-1000,title:'Old'},
          recent: {kind:'movie',identityKey:'library:recent',libraryId:'M::Тестовый фильм::2024',mediaType:'movie',currentTime:30,duration:100,updatedAt:now,title:'Recent'},
        };
        const order = continuePlaybackEntries().map(([, entry]) => entry.title);
        const first = saveAddedTmdbItem({title:'Дубль',year:2024,type:'M',tmdb_id:55,tmdb_type:'movie'}), second = saveAddedTmdbItem({title:'Другой заголовок',year:2024,type:'M',tmdb_id:55,tmdb_type:'movie'});
        const payload = canonicalSyncState({ok:true,tmdbToken:'secret',watchlist_tmdb_key:'secret2',access_token:'auth-secret',nested:{refresh_token:'refresh-secret',sourceUrl:'https://private.example/video'}});
        return {complete95:isPlaybackProgressComplete(95,100),complete94:isPlaybackProgressComplete(94,100),shortMin:playbackResumeMinimum(10.8),order,first,second,payload};
      });
      assert.equal(values.complete95,true);assert.equal(values.complete94,false);assert.ok(values.shortMin >= 2 && values.shortMin < 10);assert.deepEqual(values.order,['Recent','Old']);assert.equal(values.first,true);assert.equal(values.second,false);assert.deepEqual(values.payload,{ok:true,nested:{}});await app.close();
    });

    await run('equal local and cloud state performs no write', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),app=await openApp({stateRaw:JSON.stringify(base),normalSession:session(USERS.normal),syncMetaValue:syncMeta(base,1),cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString(),updated_by:'phone'},autoSync:false});
      await app.page.evaluate(()=>runCloudSync({manual:true}));assert.equal(app.counters.rpc,0);assert.match(await app.page.locator('#syncCard').innerText(),/Синхронизировано/);await app.close();
    });

    await run('newer cloud with clean local state auto-pulls with undo and no push loop', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),remote=JSON.parse(JSON.stringify(base));remote.notes.movie='cloud';const app=await openApp({stateRaw:JSON.stringify(base),normalSession:session(USERS.normal),syncMetaValue:syncMeta(base,1),cloudRecord:{state:remote,revision:2,updated_at:new Date().toISOString(),updated_by:'phone'},autoSync:false});
      await app.page.evaluate(()=>runCloudSync({manual:true}));assert.equal(await app.page.evaluate(()=>state.notes.movie),'cloud');assert.ok(await app.page.evaluate(()=>localStorage.getItem(CLOUD_PULL_UNDO_KEY)));assert.equal(app.counters.rpc,0);await app.page.waitForTimeout(2200);assert.equal(app.counters.rpc,0);await app.close();
    });

    await run('dirty local state pushes once against the known revision', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),local=JSON.parse(JSON.stringify(base));local.notes.movie='local';const meta=syncMeta(base,1);meta.dirty=true;const app=await openApp({stateRaw:JSON.stringify(local),normalSession:session(USERS.normal),syncMetaValue:meta,cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString(),updated_by:'phone'},autoSync:false});
      await app.page.evaluate(()=>runCloudSync({manual:true}));assert.equal(app.counters.rpc,1);assert.equal(app.cloud.record.state.notes.movie,'local');assert.equal(app.counters.rpcBodies[0].p_expected_revision,1);await app.close();
    });

    await run('conflict-free three-way merge is automatic and does not open a modal', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),local=JSON.parse(JSON.stringify(base)),remote=JSON.parse(JSON.stringify(base));local.notes.movie='local note';remote.ratings.movie=9;const meta=syncMeta(base,1);meta.dirty=true;const app=await openApp({stateRaw:JSON.stringify(local),normalSession:session(USERS.normal),syncMetaValue:meta,cloudRecord:{state:remote,revision:2,updated_at:new Date().toISOString(),updated_by:'phone'},autoSync:false});
      await app.page.evaluate(()=>runCloudSync({manual:true}));assert.equal(app.counters.rpc,1);assert.equal(app.cloud.record.state.notes.movie,'local note');assert.equal(app.cloud.record.state.ratings.movie,9);assert.equal(await app.page.locator('#modalBg').evaluate(node=>node.classList.contains('hidden')),true);await app.close();
    });

    await run('overlapping and unknown-field changes require conflict UI', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),local=JSON.parse(JSON.stringify(base)),remote=JSON.parse(JSON.stringify(base));base.future={value:'base'};local.future={value:'local'};remote.future={value:'cloud'};const meta=syncMeta(base,1);meta.dirty=true;const app=await openApp({stateRaw:JSON.stringify(local),normalSession:session(USERS.normal),syncMetaValue:meta,cloudRecord:{state:remote,revision:2,updated_at:new Date().toISOString(),updated_by:'phone'},autoSync:false});
      await app.page.evaluate(()=>runCloudSync({manual:true}));assert.equal(app.counters.rpc,0);assert.match(await app.page.locator('#modal').innerText(),/Конфликт/);assert.equal(await app.page.evaluate(()=>state.future.value),'local');await app.close();
    });

    await run('failed CAS preserves local state and never silently pulls cloud', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),local=JSON.parse(JSON.stringify(base)),remote=JSON.parse(JSON.stringify(base));local.notes.movie='local';remote.notes.movie='remote';const meta=syncMeta(base,1);meta.dirty=true;const app=await openApp({stateRaw:JSON.stringify(local),normalSession:session(USERS.normal),syncMetaValue:meta,cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},sync:{forceConflictOnce:true,conflictRecord:{state:remote,revision:2,updated_at:new Date().toISOString(),updated_by:'phone'}},autoSync:false});
      await app.page.evaluate(()=>runCloudSync({manual:true}));assert.equal(app.counters.rpc,1);assert.equal(await app.page.evaluate(()=>state.notes.movie),'local');assert.match(await app.page.locator('#modal').innerText(),/Конфликт/);await app.close({expectedConsoleErrors:[/status of 409/]});
    });

    await run('sync metadata quota failure never loses watchlist_v3', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),app=await openApp({stateRaw:JSON.stringify(base),normalSession:session(USERS.normal),syncMetaValue:syncMeta(base,1),sync:{quotaFail:true},autoSync:false});
      await app.page.evaluate(()=>{state.pins=['M::Тестовый фильм::2024'];saveState({origin:SYNC_ORIGINS.LOCAL,reason:'quota-test'})});const stored=JSON.parse(await app.page.evaluate(key=>localStorage.getItem(key),STATE_KEY));assert.deepEqual(stored.pins,['M::Тестовый фильм::2024']);assert.match(await app.page.locator('#syncCard').innerText(),/служебные данные не сохранены/);await app.close();
    });

    await run('active lease is respected and stale lease is recovered', async () => {
      const app=await openApp({autoSync:false}),values=await app.page.evaluate(()=>{initCloudTabId();localStorage.setItem(CLOUD_LEASE_KEY,JSON.stringify({owner:'other',expiresAt:Date.now()+60000}));const active=acquireCloudLease();localStorage.setItem(CLOUD_LEASE_KEY,JSON.stringify({owner:'other',expiresAt:Date.now()-1}));const stale=acquireCloudLease();releaseCloudLease();return {active,stale}});assert.deepEqual(values,{active:false,stale:true});await app.close();
    });

    await run('dirty tab merges independent storage changes and never overwrites overlap silently', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),local=JSON.parse(JSON.stringify(base)),external=JSON.parse(JSON.stringify(base));local.notes.movie='local';external.ratings.movie=8;const meta=syncMeta(base,1);meta.dirty=true;const app=await openApp({stateRaw:JSON.stringify(local),normalSession:session(USERS.normal),syncMetaValue:meta,autoSync:false});
      const merged=await app.page.evaluate(({external,key})=>{localStorage.setItem(key,JSON.stringify(external));handleCloudStorageEvent({key,newValue:JSON.stringify(external)});return {notes:state.notes.movie,rating:state.ratings.movie}}, {external,key:STATE_KEY});assert.deepEqual(merged,{notes:'local',rating:8});
      const overlap=JSON.parse(JSON.stringify(base));overlap.notes.movie='external';await app.page.evaluate(({overlap,key})=>{state.notes.movie='local-2';const meta=loadCloudMeta();meta.dirty=true;meta.baseSnapshot=JSON.parse(JSON.stringify(meta.baseSnapshot));storeCloudMeta(meta);localStorage.setItem(key,JSON.stringify(overlap));handleCloudStorageEvent({key,newValue:JSON.stringify(overlap)})},{overlap,key:STATE_KEY});assert.equal(await app.page.evaluate(()=>state.notes.movie),'local-2');assert.equal(await app.page.evaluate(()=>cloudConflictContext?.kind),'tab');await app.close();
    });

    await run('feature switch disables background sync but keeps manual sync', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),app=await openApp({stateRaw:JSON.stringify(base),normalSession:session(USERS.normal),syncMetaValue:syncMeta(base,1),cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},autoSync:false});await app.page.waitForTimeout(100);assert.equal(app.counters.rest,0);await app.page.evaluate(()=>syncCloudNow());assert.ok(app.counters.rest>=1);await app.close();
    });

    await run('logout cancels every automatic sync timer', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),app=await openApp({stateRaw:JSON.stringify(base),normalSession:session(USERS.normal),syncMetaValue:syncMeta(base,1),cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},autoSync:false});await app.page.evaluate(()=>{cloudSyncTimer=setTimeout(()=>{},60000);cloudPlaybackTimer=setTimeout(()=>{},60000);cloudRetryTimer=setTimeout(()=>{},60000);cloudPollTimer=setInterval(()=>{},60000);cloudLeaseTimer=setInterval(()=>{},60000);return signOutCloud()});const timers=await app.page.evaluate(()=>({sync:cloudSyncTimer,playback:cloudPlaybackTimer,retry:cloudRetryTimer,poll:cloudPollTimer,lease:cloudLeaseTimer}));assert.deepEqual(timers,{sync:0,playback:0,retry:0,poll:0,lease:0});await app.close();
    });

    await run('logout immediately aborts sync and stays signed out when server logout fails', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),app=await openApp({stateRaw:JSON.stringify(base),normalSession:session(USERS.normal),syncMetaValue:syncMeta(base,1),cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},sync:{restDelay:500},auth:{logoutDelay:300,logoutNetwork:true},autoSync:false});
      await app.page.evaluate(()=>{window.__pendingSync=runCloudSync({manual:true})});await app.page.waitForFunction(()=>!!cloudSyncAbortController);
      const immediate=await app.page.evaluate(({sessionKey,leaseKey})=>{const controller=cloudSyncAbortController;window.__pendingLogout=signOutCloud();return {aborted:controller.signal.aborted,session:localStorage.getItem(sessionKey),lease:localStorage.getItem(leaseKey),timers:[cloudSyncTimer,cloudPlaybackTimer,cloudRetryTimer,cloudPollTimer,cloudLeaseTimer]}} ,{sessionKey:SESSION_KEY,leaseKey:'watchlist_supabase_sync_lease'});
      assert.equal(immediate.aborted,true);assert.equal(immediate.session,null);assert.equal(immediate.lease,null);assert.deepEqual(immediate.timers,[0,0,0,0,0]);await app.page.waitForTimeout(650);assert.equal(app.counters.rpc,0);assert.equal(await app.page.evaluate(key=>localStorage.getItem(key),SESSION_KEY),null);await app.close({expectedConsoleErrors:[/ERR_FAILED/]});
    });

    await run('logout during delayed expired-session refresh cannot resurrect session', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),expired=session(USERS.normal,'expired');expired.expires_at=Math.floor(Date.now()/1000)-60;
      const app=await openApp({stateRaw:JSON.stringify(base),normalSession:expired,syncMetaValue:syncMeta(base,1),cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},auth:{refreshDelay:350},autoSync:false});
      await app.page.evaluate(()=>{window.__refreshingSync=runCloudSync({manual:true})});await app.page.waitForFunction(()=>cloudSyncAbortController&&cloudSyncBusy);while(app.counters.refresh<1)await app.page.waitForTimeout(10);
      await app.page.evaluate(()=>signOutCloud());await app.page.waitForTimeout(500);const result=await app.page.evaluate(({sessionKey,leaseKey})=>({session:cloudSession,stored:localStorage.getItem(sessionKey),lease:localStorage.getItem(leaseKey),timers:[cloudSyncTimer,cloudPlaybackTimer,cloudRetryTimer,cloudPollTimer,cloudLeaseTimer]}),{sessionKey:SESSION_KEY,leaseKey:'watchlist_supabase_sync_lease'});
      assert.equal(result.session,null);assert.equal(result.stored,null);assert.equal(result.lease,null);assert.deepEqual(result.timers,[0,0,0,0,0]);assert.equal(app.counters.rest,0);assert.equal(app.counters.rpc,0);await app.page.waitForTimeout(250);assert.equal(await app.page.evaluate(key=>localStorage.getItem(key),SESSION_KEY),null);await app.close({expectedConsoleErrors:[/ERR_FAILED|ERR_ABORTED/]});
    });

    await run('foreign-user sync metadata is ignored conservatively', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),local=JSON.parse(JSON.stringify(base));local.notes.movie='local';const foreign=syncMeta(base,7,'another-user'),app=await openApp({stateRaw:JSON.stringify(local),normalSession:session(USERS.normal),syncMetaValue:foreign,cloudRecord:{state:base,revision:7,updated_at:new Date().toISOString()},autoSync:false});await app.page.evaluate(()=>runCloudSync({manual:true}));assert.equal(app.counters.rpc,0);assert.match(await app.page.locator('#modal').innerText(),/Первая синхронизация/);await app.close();
    });

    await run('undo cloud pull stays dirty and pushes instead of downloading again', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),remote=JSON.parse(JSON.stringify(base));remote.notes.movie='cloud';const app=await openApp({stateRaw:JSON.stringify(base),normalSession:session(USERS.normal),syncMetaValue:syncMeta(base,1),cloudRecord:{state:remote,revision:2,updated_at:new Date().toISOString()},autoSync:false});await app.page.evaluate(()=>runCloudSync({manual:true}));await app.page.evaluate(()=>{window.confirm=()=>true;undoLastCloudPull()});await app.page.evaluate(()=>runCloudSync({manual:true}));assert.equal(app.counters.rpc,1);assert.equal(app.cloud.record.state.notes.movie,undefined);await app.close();
    });

    await run('three-way resolver is conservative for equal, playback, scalar and delete/edit cases', async () => {
      const app=await openApp({autoSync:false}),result=await app.page.evaluate(()=>{
        const base={notes:{a:'base'},playbackProgress:{ep:{updatedAt:1,currentTime:10}}};
        const equal=resolveThreeWayState(base,{...base,notes:{a:'same'}},{...base,notes:{a:'same'}});
        const playback=resolveThreeWayState(base,{...base,playbackProgress:{ep:{updatedAt:3,currentTime:30}}},{...base,playbackProgress:{ep:{updatedAt:2,currentTime:20}}});
        const scalar=resolveThreeWayState(base,{...base,notes:{a:'local'}},{...base,notes:{a:'cloud'}});
        const deleted=resolveThreeWayState({addedItems:[{title:'A',year:2020,type:'M',desc:'base'}]}, {addedItems:[]}, {addedItems:[{title:'A',year:2020,type:'M',desc:'edited'}]});
        return {equal:equal.ok,playback:playback.value.playbackProgress.ep.currentTime,scalar:scalar.ok,deleted:deleted.ok};
      });assert.deepEqual(result,{equal:true,playback:30,scalar:false,deleted:false});await app.close();
    });

    await run('automatic conflict resolution performs exactly one controlled CAS', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),local=JSON.parse(JSON.stringify(base)),remote=JSON.parse(JSON.stringify(base));local.notes.a='local';remote.ratings.b=7;const meta=syncMeta(base,1);meta.dirty=true;const app=await openApp({stateRaw:JSON.stringify(local),normalSession:session(USERS.normal),syncMetaValue:meta,cloudRecord:{state:remote,revision:2,updated_at:new Date().toISOString()},autoSync:true});await app.page.waitForFunction(()=>loadCloudMeta().dirty===false);await app.page.waitForTimeout(2200);assert.equal(app.counters.rpc,1);assert.equal(await app.page.evaluate(()=>cloudSyncTimer),0);await app.close();
    });

    await run('missing conflict rollback capacity disables automatic merge', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),local=JSON.parse(JSON.stringify(base)),remote=JSON.parse(JSON.stringify(base));local.notes.a='local';remote.ratings.b=7;const meta=syncMeta(base,1);meta.dirty=true;const app=await openApp({stateRaw:JSON.stringify(local),normalSession:session(USERS.normal),syncMetaValue:meta,cloudRecord:{state:remote,revision:2,updated_at:new Date().toISOString()},sync:{conflictQuotaFail:true},autoSync:false});await app.page.evaluate(()=>runCloudSync({manual:true}));assert.equal(app.counters.rpc,0);assert.match(await app.page.locator('#modal').innerText(),/Конфликт/);await app.close();
    });

    await run('cloud, tab and startup origins never schedule a network push', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),app=await openApp({stateRaw:JSON.stringify(base),normalSession:session(USERS.normal),syncMetaValue:syncMeta(base,1),cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},autoSync:true});await app.page.waitForTimeout(100);const before=app.counters.rpc;await app.page.evaluate(()=>{saveState({origin:SYNC_ORIGINS.CLOUD});saveState({origin:SYNC_ORIGINS.TAB});saveState({origin:SYNC_ORIGINS.STARTUP});state.tmdbUnresolvedExpanded=true;saveState()});await app.page.waitForTimeout(2200);assert.equal(app.counters.rpc,before);assert.equal(await app.page.evaluate(()=>loadCloudMeta().dirty),false);await app.close();
    });

    await run('confirmed import is dirty only after its final state write', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),app=await openApp({stateRaw:JSON.stringify(base),normalSession:session(USERS.normal),syncMetaValue:syncMeta(base,1),autoSync:false});const meta=await app.page.evaluate(()=>{state.notes.imported='yes';saveState({origin:SYNC_ORIGINS.IMPORT,reason:'backup-merge'});return loadCloudMeta()});assert.equal(meta.dirty,true);assert.equal(meta.dirtyKind,'import');assert.equal(meta.dirtyReason,'backup-merge');await app.close();
    });

    await run('ordinary mutations debounce into one upload and playback uses its longer timer', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),app=await openApp({stateRaw:JSON.stringify(base),normalSession:session(USERS.normal),syncMetaValue:syncMeta(base,1),cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},autoSync:true});await app.page.waitForTimeout(100);await app.page.evaluate(()=>{state.notes.a='one';saveState();state.ratings.b=8;saveState()});await app.page.waitForTimeout(2500);assert.equal(app.counters.rpc,1);await app.page.evaluate(()=>{state.playbackProgress.test={kind:'movie',identityKey:'test',mediaType:'movie',currentTime:20,duration:100,updatedAt:Date.now(),completed:false};saveState({origin:SYNC_ORIGINS.PLAYBACK,reason:'playback-progress'})});const timerActive=await app.page.evaluate(()=>cloudPlaybackTimer!==0);assert.equal(timerActive,true);await app.page.waitForTimeout(2200);assert.equal(app.counters.rpc,1);await app.close();
    });

    await run('repeated playback saves cannot postpone the first cloud deadline', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),app=await openApp({stateRaw:JSON.stringify(base),normalSession:session(USERS.normal),syncMetaValue:syncMeta(base,1),cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},autoSync:true,playbackSyncMs:180});await app.page.waitForTimeout(100);const before=app.counters.rpc;
      const save=seconds=>app.page.evaluate(seconds=>{state.playbackProgress.test={kind:'movie',identityKey:'test',mediaType:'movie',currentTime:seconds,duration:100,updatedAt:Date.now(),completed:false};saveState({origin:SYNC_ORIGINS.PLAYBACK,reason:'playback-progress'})},seconds);
      await save(20);const firstTimer=await app.page.evaluate(()=>cloudPlaybackTimer);await app.page.waitForTimeout(60);await save(25);assert.equal(await app.page.evaluate(()=>cloudPlaybackTimer),firstTimer);await app.page.waitForTimeout(60);await save(30);assert.equal(await app.page.evaluate(()=>cloudPlaybackTimer),firstTimer);await app.page.waitForTimeout(160);assert.equal(app.counters.rpc,before+1);await app.page.waitForTimeout(180);assert.equal(app.counters.rpc,before+1);await app.close();
    });

    await run('clean poll failure followed by remote update retries as pull without RPC', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),remote=JSON.parse(JSON.stringify(base)),meta=syncMeta(base,1),app=await openApp({stateRaw:JSON.stringify(base),syncMetaValue:meta,cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},sync:{readFailures:1},autoSync:true,retrySteps:[500]});await app.page.evaluate(value=>storeCloudSession(value),session(USERS.normal));await app.page.evaluate(()=>runCloudSync({reason:'poll'}));assert.equal(await app.page.evaluate(()=>loadCloudMeta().dirty),false);remote.notes.remote='newer';app.cloud.record={state:remote,revision:2,updated_at:new Date().toISOString(),updated_by:'other-device'};await app.page.evaluate(()=>runCloudSync({reason:'retry'}));assert.equal(await app.page.evaluate(()=>state.notes.remote),'newer');assert.equal(app.counters.rpc,0);assert.equal(await app.page.evaluate(()=>cloudConflictContext),null);assert.equal(await app.page.evaluate(()=>cloudRetryTimer),0);await app.close({expectedConsoleErrors:[/status of 503/]});
    });

    await run('successful sync cancels a stale retry timer', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),app=await openApp({stateRaw:JSON.stringify(base),syncMetaValue:syncMeta(base,1),cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},autoSync:true,retrySteps:[150]});await app.page.evaluate(value=>storeCloudSession(value),session(USERS.normal));await app.page.evaluate(()=>scheduleCloudRetry(new Error('temporary')));assert.notEqual(await app.page.evaluate(()=>cloudRetryTimer),0);const before=app.counters.rest;await app.page.evaluate(()=>runCloudSync({reason:'online'}));assert.equal(await app.page.evaluate(()=>cloudRetryTimer),0);await app.page.waitForTimeout(250);assert.equal(app.counters.rest,before+1);assert.equal(await app.page.evaluate(()=>loadCloudMeta().retryAttempt),0);await app.close();
    });

    await run('offline mutation remains pending and reconnect retries it', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),app=await openApp({stateRaw:JSON.stringify(base),normalSession:session(USERS.normal),syncMetaValue:syncMeta(base,1),cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},autoSync:true});await app.page.waitForTimeout(100);await app.context.setOffline(true);await app.page.evaluate(()=>{state.notes.offline='pending';saveState()});await app.page.waitForTimeout(2200);assert.equal(app.counters.rpc,0);assert.equal(await app.page.evaluate(()=>loadCloudMeta().dirty),true);await app.context.setOffline(false);await app.page.evaluate(()=>window.dispatchEvent(new Event('online')));await app.page.waitForFunction(()=>loadCloudMeta().dirty===false);assert.equal(app.counters.rpc,1);await app.close();
    });

    await run('visibility restore triggers a check while hidden state does not', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),app=await openApp({stateRaw:JSON.stringify(base),normalSession:session(USERS.normal),syncMetaValue:syncMeta(base,1),cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},autoSync:true});await app.page.waitForTimeout(100);const before=app.counters.rest;await app.page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))});await app.page.waitForTimeout(100);assert.equal(app.counters.rest,before);await app.page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))});await app.page.waitForTimeout(100);assert.ok(app.counters.rest>before);await app.close();
    });

    await run('first sync pulls only an effectively empty local state', async () => {
      const empty=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),remote=JSON.parse(JSON.stringify(empty));remote.notes.a='cloud';const app=await openApp({stateRaw:JSON.stringify(empty),normalSession:session(USERS.normal),cloudRecord:{state:remote,revision:4,updated_at:new Date().toISOString()},autoSync:false});await app.page.evaluate(()=>runCloudSync({manual:true}));assert.equal(await app.page.evaluate(()=>state.notes.a),'cloud');assert.equal(app.counters.rpc,0);await app.close();
    });

    await run('first sync uploads non-empty local state only when cloud is absent', async () => {
      const local=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE));local.notes.a='local';const app=await openApp({stateRaw:JSON.stringify(local),normalSession:session(USERS.normal),cloudRecord:null,autoSync:false});await app.page.evaluate(()=>runCloudSync({manual:true}));assert.equal(app.counters.rpc,1);assert.equal(app.counters.rpcBodies[0].p_expected_revision,0);assert.equal(app.cloud.record.state.notes.a,'local');await app.close();
    });

    await run('startup retries a durable pending mutation after reload', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),local=JSON.parse(JSON.stringify(base));local.notes.pending='reload';const meta=syncMeta(base,1);meta.dirty=true;meta.dirtyKind='local-user';const app=await openApp({stateRaw:JSON.stringify(local),normalSession:session(USERS.normal),syncMetaValue:meta,cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},autoSync:true});await app.page.waitForFunction(()=>loadCloudMeta().dirty===false);assert.equal(app.counters.rpc,1);assert.equal(app.cloud.record.state.notes.pending,'reload');await app.close();
    });

    await run('large-screen sync controls remain focusable without horizontal overflow', async () => {
      const base=JSON.parse(JSON.stringify(SYNC_STATE_FIXTURE)),app=await openApp({viewport:{width:1920,height:1080},stateRaw:JSON.stringify(base),normalSession:session(USERS.normal),syncMetaValue:syncMeta(base,1),cloudRecord:{state:base,revision:1,updated_at:new Date().toISOString()},autoSync:false});await app.page.locator('[data-view="profile"]:visible').first().click();await app.page.locator('#cloudSyncNow').focus();assert.equal(await app.page.evaluate(()=>document.activeElement?.id),'cloudSyncNow');const size=await app.page.evaluate(()=>({inner:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.inner+1,JSON.stringify(size));await app.close();
    });

    await run('compatibility redirect preserves query and hash', async () => {
      const app = await openApp({pathName: '/v6-beta15.html?probe=1#search'});await app.page.waitForFunction(() => location.pathname === '/' && location.search === '?probe=1' && location.hash === '#search');await app.page.locator('#view-search.active').waitFor();await app.close();
    });

    console.log(`\n${passed} browser regression checks passed.`);
  } finally {
    await browser.close();await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {console.error(error.stack || error);process.exitCode = 1});
