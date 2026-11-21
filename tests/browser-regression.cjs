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

  async function openApp({pathName = '/', viewport = {width: 1280, height: 720}, stateRaw = JSON.stringify(STATE_FIXTURE), normalSession = null, recoverySession = null, backupValue = null, auth = {}} = {}) {
    const counters = {recover: 0, signup: 0, update: 0, passwordGrant: 0, rest: 0, logout: 0};
    const context = await browser.newContext({viewport, serviceWorkers: 'block'});
    await context.addInitScript(config => {
      if (location.origin !== config.origin) return;
      if (config.stateRaw !== null) localStorage.setItem(config.stateKey, config.stateRaw);
      localStorage.setItem(config.tokenKey, 'fixture-tmdb-token');
      if (config.normalSession) localStorage.setItem(config.sessionKey, JSON.stringify(config.normalSession));
      if (config.recoverySession) sessionStorage.setItem(config.recoveryKey, JSON.stringify(config.recoverySession));
      if (config.backupValue !== null) localStorage.setItem('fixture_backup', config.backupValue);
    }, {origin, stateRaw, stateKey: STATE_KEY, tokenKey: TOKEN_KEY, sessionKey: SESSION_KEY, recoveryKey: RECOVERY_KEY, normalSession, recoverySession, backupValue});
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
        if (pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {await json(200, session(USERS.recovered, 'refreshed'));return;}
        if (pathname === '/auth/v1/logout') {counters.logout += 1;await json(200, {});return;}
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
    return {context, page, errors, counters, close};
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
        const payload = canonicalSyncState({ok:true,tmdbToken:'secret',watchlist_tmdb_key:'secret2'});
        return {complete95:isPlaybackProgressComplete(95,100),complete94:isPlaybackProgressComplete(94,100),shortMin:playbackResumeMinimum(10.8),order,first,second,payload};
      });
      assert.equal(values.complete95,true);assert.equal(values.complete94,false);assert.ok(values.shortMin >= 2 && values.shortMin < 10);assert.deepEqual(values.order,['Recent','Old']);assert.equal(values.first,true);assert.equal(values.second,false);assert.deepEqual(values.payload,{ok:true});await app.close();
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
