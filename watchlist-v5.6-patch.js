/* Watchlist v5.6 patch
   Loaded AFTER the existing inline v5.5 script.
   Fixes:
   - global search across movies + series
   - search hit highlighting + type badges
   - TMDB refresh for every item missing metadata, including addedItems
   - correct rating-desc sorting after TMDB add
   - compatible backup/import for Safari <-> installed iOS PWA transfer
   - clearer standalone/PWA storage status
   - stronger app update/cache reset
*/
(() => {
  'use strict';

  const V56 = '5.6';
  const isStandalone = () =>
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;

  function injectV56Styles(){
    if (document.getElementById('v56Styles')) return;
    const s = document.createElement('style');
    s.id = 'v56Styles';
    s.textContent = `
      mark.search-hit{
        background:rgba(212,162,76,.30);
        color:inherit;
        border-radius:3px;
        padding:0 .08em;
        box-shadow:0 0 0 1px rgba(212,162,76,.18);
      }
      .type-badge{
        display:inline-flex;align-items:center;gap:4px;
        margin:0 0 5px 6px;padding:2px 7px;border-radius:999px;
        border:1px solid var(--rule);background:var(--bg2);
        color:var(--muted);font-size:10px;font-weight:600;vertical-align:middle
      }
      .v56-storage-banner{
        max-width:960px;margin:8px auto 0;padding:10px 14px;border:1px solid var(--rule);
        border-radius:10px;background:var(--bg2);color:var(--muted);font-size:12px;
        line-height:1.5;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap
      }
      .v56-storage-banner b{color:var(--gold)}
      .v56-storage-banner .btn{padding:7px 12px;font-size:11px}
      .v56-search-note{max-width:960px;margin:2px auto 4px;padding:0 16px;color:var(--muted);font-size:11px}
      .v56-search-note b{color:var(--gold)}
    `;
    document.head.appendChild(s);
  }

  function setVersionLabels(){
    document.title = 'Мой ватчлист · v5.6';
    const eyebrow = document.querySelector('.eyebrow');
    if (eyebrow) eyebrow.textContent = eyebrow.textContent.replace(/v\d+(?:\.\d+)?/i, 'v5.6');
    const footer = document.querySelector('footer');
    if (footer) {
      for (const node of [...footer.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE && /Версия\s+v/i.test(node.textContent || '')) {
          node.textContent = (node.textContent || '').replace(/Версия\s+v\d+(?:\.\d+)?/i, 'Версия v5.6');
        }
      }
      footer.innerHTML = footer.innerHTML.replace(/Версия\s+v\d+(?:\.\d+)?/i, 'Версия v5.6');
    }
  }

  function dedupeById(itemsList){
    const out = [];
    const seen = new Set();
    for (const it of itemsList || []) {
      const id = idFor(it);
      if (!seen.has(id)) {
        seen.add(id);
        out.push(it);
      }
    }
    return out;
  }

  // Search globally whenever text is entered. With an empty query,
  // tabs keep their original movie/series behavior.
  filteredItems = function(){
    const needle = normalizeSearch(query);
    const source = needle ? dedupeById(allItems()) : currentData();

    let result = source.filter(it => {
      if (needle) {
        const hay = normalizeSearch([it.title, it.desc || '', ...(it.genres || [])].join(' '));
        if (!hay.includes(needle)) return false;
      }
      if (hideWatched && watched.has(idFor(it))) return false;
      const effectiveRating = it.tmdb_rating != null ? it.tmdb_rating : it.rating;
      if (minRating > 0 && (effectiveRating == null || effectiveRating < minRating)) return false;
      if (activeGenres.size) {
        const gs = it.genres || [];
        if (![...activeGenres].every(g => gs.includes(g))) return false;
      }
      if (activeMood) {
        const allowed = MOOD_GENRES[activeMood] || [];
        const gs = it.genres || [];
        if (!gs.some(g => allowed.includes(g))) return false;
      }
      return true;
    });

    result.sort((a,b) => {
      const pa = pins.has(idFor(a)) && !watched.has(idFor(a));
      const pb = pins.has(idFor(b)) && !watched.has(idFor(b));
      if (pa !== pb) return pa ? -1 : 1;
      if (sortBy === 'rating-desc') return ((b.tmdb_rating ?? b.rating) || 0) - ((a.tmdb_rating ?? a.rating) || 0);
      if (sortBy === 'rating-asc') return ((a.tmdb_rating ?? a.rating) || 0) - ((b.tmdb_rating ?? b.rating) || 0);
      if (sortBy === 'year-desc') return (b.year || 0) - (a.year || 0);
      if (sortBy === 'year-asc') return (a.year || 0) - (b.year || 0);
      if (sortBy === 'title') return a.title.localeCompare(b.title, 'ru');
      if (sortBy === 'my-rating') return (ratings[idFor(b)] || 0) - (ratings[idFor(a)] || 0);
      return 0;
    });
    return result;
  };

  function regexForQuery(raw){
    const q = String(raw || '').trim();
    if (!q) return null;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[её]/gi, '[её]');
    try { return new RegExp(`(${escaped})`, 'gi'); } catch(e) { return null; }
  }

  function highlightTextNodes(root, re){
    if (!root || !re) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const textNode of nodes) {
      const text = textNode.nodeValue || '';
      re.lastIndex = 0;
      if (!re.test(text)) continue;
      re.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let last = 0;
      text.replace(re, (match, _g, offset) => {
        if (offset > last) frag.appendChild(document.createTextNode(text.slice(last, offset)));
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = match;
        frag.appendChild(mark);
        last = offset + match.length;
        return match;
      });
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }

  function postProcessSearchResults(){
    const needle = normalizeSearch(query);
    let note = document.getElementById('v56SearchNote');

    if (!needle) {
      if (note) note.remove();
      return;
    }

    if (!note) {
      note = document.createElement('div');
      note.id = 'v56SearchNote';
      note.className = 'v56-search-note';
      const anchor = document.getElementById('genreBar');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(note, anchor);
    }

    const rows = [...document.querySelectorAll('#list .row')];
    const movies = rows.filter(r => (r.dataset.id || '').startsWith('M::')).length;
    const series = rows.filter(r => (r.dataset.id || '').startsWith('S::')).length;
    note.innerHTML = `🔎 Поиск идёт сразу по <b>фильмам и сериалам</b> · найдено: ${rows.length} (${movies} 🎬 / ${series} 📺)`;

    const re = regexForQuery(query);
    rows.forEach(row => {
      const id = row.dataset.id || '';
      const title = row.querySelector('.title');
      if (title && !title.querySelector('.type-badge')) {
        const badge = document.createElement('span');
        badge.className = 'type-badge';
        badge.textContent = id.startsWith('S::') ? '📺 Сериал' : '🎬 Фильм';
        title.appendChild(badge);
      }
      highlightTextNodes(row.querySelector('.title a'), re);
      highlightTextNodes(row.querySelector('.desc'), re);
    });
  }

  const renderV55 = render;
  render = function(){
    renderV55();
    postProcessSearchResults();
    updateTmdbStatusV56();
  };

  // v5.5 tries to switch tabs while typing. v5.6 no longer needs that:
  // search is global, tabs remain as the browsing scope only when search is empty.
  const searchInput = document.getElementById('search');
  if (searchInput) {
    searchInput.placeholder = 'Поиск по фильмам и сериалам...';
    searchInput.oninput = e => {
      query = e.target.value;
      render();
    };
  }

  // Fix v5.5's invalid sort value "rating" after adding from TMDB.
  document.addEventListener('click', e => {
    const el = e.target;
    if (!(el instanceof Element) || el.id !== 'addTmdb') return;
    setTimeout(() => {
      sortBy = 'rating-desc';
      const select = document.getElementById('sortSelect');
      if (select) select.value = 'rating-desc';
      saveState();
      render();
    }, 0);
  }, true);

  function itemNeedsTmdb(it){
    const merged = mergeTmdbMeta(it);
    return !merged.poster_url || merged.tmdb_rating == null || !merged.desc ||
      merged.desc === 'Описание отсутствует';
  }

  function tmdbCoverage(){
    const base = listMode === 'personal' ? addedItems : [...DATA.movies, ...DATA.series, ...addedItems];
    const unique = dedupeById(base);
    const ready = unique.filter(it => {
      const x = mergeTmdbMeta(it);
      return !!x.poster_url && x.tmdb_rating != null;
    }).length;
    return {ready, total: unique.length};
  }

  function updateTmdbStatusV56(extra=''){
    const status = document.getElementById('tmdbStatus');
    if (!status) return;
    const {ready,total} = tmdbCoverage();
    const token = tmdbGetKey();
    status.textContent = `✨ TMDB: ${ready}/${total} с постером и рейтингом · токен ${token ? '✓' : 'не задан'}${extra ? ' · ' + extra : ''}`;
  }

  refreshExistingFromTmdb = async function(options = {}){
    if (tmdbRefreshRunning) return;
    if (!tmdbGetKey()) {
      updateTmdbStatusV56('нужен токен');
      return options.silent ? false : toast('Сначала сохрани TMDB Token в 🔎 TMDB');
    }

    tmdbRefreshRunning = true;
    const allSource = listMode === 'personal'
      ? [...addedItems]
      : [...DATA.movies, ...DATA.series, ...addedItems];

    const targets = dedupeById(allSource).filter(itemNeedsTmdb);
    if (!targets.length) {
      tmdbRefreshRunning = false;
      updateTmdbStatusV56('всё заполнено');
      if (!options.silent) toast('Данные TMDB уже заполнены');
      return true;
    }

    const showModal = !options.silent;
    if (showModal) {
      openModal(`<h3>✨ Обновление данных TMDB</h3>
        <p id="tmdbProgress" class="hint">0 / ${targets.length}</p>
        <div class="result-card">
          <div style="height:8px;background:var(--rule);border-radius:5px">
            <div id="tmdbBarFill" style="height:100%;width:0%;background:var(--gold);border-radius:5px"></div>
          </div>
        </div>
        <p class="hint">v5.6 обновляет только карточки, где не хватает постера, рейтинга или описания.</p>`);
    }

    let idx = 0, done = 0, good = 0;
    updateTmdbStatusV56(`обновление 0/${targets.length}`);

    const worker = async () => {
      while (true) {
        const item = targets[idx++];
        if (!item) break;
        try {
          if (await enrichOne(item)) good++;
        } catch(e) {
          console.warn('TMDB enrich failed', item && item.title, e);
        }
        done++;
        saveState();

        const pct = Math.round(done / targets.length * 100);
        const p = document.getElementById('tmdbProgress');
        const fill = document.getElementById('tmdbBarFill');
        if (p) p.textContent = `${done} / ${targets.length} · найдено ${good}`;
        if (fill) fill.style.width = pct + '%';
        updateTmdbStatusV56(`обновление ${done}/${targets.length}`);

        // Do not re-render every single request; this is much lighter on iPhone.
        if (done % 5 === 0 || done === targets.length) {
          renderGenreBar();
          render();
        }
      }
    };

    // Two concurrent workers are gentler on mobile/TMDB than the old three-worker burst.
    await Promise.all([worker(), worker()]);
    tmdbRefreshRunning = false;
    saveState();
    renderGenreBar();
    render();
    updateTmdbStatusV56(`обновлено ${good}/${targets.length}`);
    if (!options.silent) toast(`TMDB: обновлено ${good} из ${targets.length}`);
    return true;
  };

  const refreshBtn = document.getElementById('refreshTmdbBtn');
  if (refreshBtn) refreshBtn.onclick = () => refreshExistingFromTmdb({silent:false});

  function portableState(){
    return {
      version: V56,
      exportedAt: new Date().toISOString(),
      state: {
        watched:[...watched],
        pins:[...pins],
        ratings,
        notes,
        gridView,
        addedItems,
        watchedDates,
        tonightId,
        appTheme,
        tmdbMeta,
        listMode,
        sortBy
      },
      tmdbToken: tmdbGetKey()
    };
  }

  function normalizeImportedPayload(raw){
    // Accept v5.6/v5.5 nested backups AND old flat exports.
    const src = raw && raw.state && typeof raw.state === 'object' ? raw.state : (raw || {});
    return {
      watched: src.watched || raw?.watched || [],
      pins: src.pins || raw?.pins || [],
      ratings: src.ratings || raw?.ratings || {},
      notes: src.notes || raw?.notes || {},
      gridView: 'gridView' in src ? !!src.gridView : gridView,
      addedItems: Array.isArray(src.addedItems) ? src.addedItems :
        (Array.isArray(raw?.addedItems) ? raw.addedItems : []),
      watchedDates: src.watchedDates || raw?.watchedDates || {},
      tonightId: 'tonightId' in src ? src.tonightId : (raw?.tonightId ?? null),
      appTheme: src.appTheme || raw?.appTheme || appTheme || 'warm',
      tmdbMeta: src.tmdbMeta || raw?.tmdbMeta || {},
      listMode: src.listMode || raw?.listMode || 'shared',
      sortBy: src.sortBy || raw?.sortBy || sortBy || 'default',
      tmdbToken: raw?.tmdbToken || src.tmdbToken || ''
    };
  }

  function applyImportedState(raw){
    const x = normalizeImportedPayload(raw);
    watched = new Set(x.watched);
    pins = new Set(x.pins);
    ratings = x.ratings;
    notes = x.notes;
    gridView = x.gridView;
    addedItems = x.addedItems;
    watchedDates = x.watchedDates;
    tonightId = x.tonightId;
    appTheme = x.appTheme;
    tmdbMeta = x.tmdbMeta;
    listMode = x.listMode;
    sortBy = x.sortBy;
    if (x.tmdbToken) tmdbSetKey(x.tmdbToken);

    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect && [...sortSelect.options].some(o => o.value === sortBy)) sortSelect.value = sortBy;

    saveState();
    applyTheme();
    updateProgress();
    renderGenreBar();
    renderTonightSlot();
    render();
    updateStorageBanner();
  }

  function downloadPortableBackup(filename='мой-ватчлист-v5.6.json'){
    const payload = portableState();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Резервная копия v5.6 сохранена');
  }

  function importPortableFile(file, done){
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        applyImportedState(JSON.parse(r.result));
        if (typeof done === 'function') done();
        toast('Данные, TMDB-кэш и токен восстановлены');
        // Fill missing metadata after import rather than wiping imported cache.
        setTimeout(() => refreshExistingFromTmdb({silent:true}), 350);
      } catch(err) {
        console.error(err);
        toast('Ошибка JSON');
      }
    };
    r.readAsText(file);
  }

  openExport = function(){
    const modeText = isStandalone() ? 'установленном приложении' : 'Safari / браузере';
    openModal(`<h3>📤 Импорт, экспорт и перенос</h3>
      <p class="hint">Полная копия v5.6 содержит прогресс, добавленные фильмы/сериалы, TMDB-постеры и рейтинг, настройки и TMDB Token.</p>
      <div class="result-card">
        <b>📲 Перенос Safari ↔ ярлык</b>
        <p class="hint">Сейчас открыто в ${modeText}. Скачай полный JSON там, где данные есть, затем импортируй этот же файл там, где их нет.</p>
      </div>
      <div class="btn-row" style="flex-direction:column;align-items:stretch">
        <button class="btn primary" id="dlJson">💾 Скачать полную копию v5.6</button>
        <button class="btn" id="copyJson">📋 Скопировать полный JSON</button>
        <button class="btn" id="copyMessenger">Список для мессенджера</button>
        <label class="btn primary" style="cursor:pointer">📥 Импортировать полную копию
          <input type="file" id="importFile" accept=".json,application/json" style="display:none">
        </label>
      </div>`);

    document.getElementById('dlJson').onclick = () => downloadPortableBackup();
    document.getElementById('copyJson').onclick = () =>
      navigator.clipboard.writeText(JSON.stringify(portableState(), null, 2)).then(() => toast('Полный JSON скопирован'));
    document.getElementById('copyMessenger').onclick = () => {
      const text = '🎬 Хочу посмотреть:\n\n' + getUnwatched()
        .map(it => `• ${it.title}${it.year ? ' ('+it.year+')' : ''} — ${it.type==='M'?'фильм':'сериал'}${(it.tmdb_rating??it.rating)!=null?' ★'+(it.tmdb_rating??it.rating):''}`)
        .join('\n');
      navigator.clipboard.writeText(text).then(() => toast('Скопировано'));
    };
    document.getElementById('importFile').onchange = e =>
      importPortableFile(e.target.files[0], () => closeModal());
  };

  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.onclick = openExport;

  const backupBtn = document.getElementById('backupBtn');
  if (backupBtn) {
    backupBtn.textContent = '💾 Полная копия';
    backupBtn.onclick = () => downloadPortableBackup();
  }

  function ensureStorageBanner(){
    let b = document.getElementById('v56StorageBanner');
    if (b) return b;
    b = document.createElement('div');
    b.id = 'v56StorageBanner';
    b.className = 'v56-storage-banner';
    const status = document.getElementById('tmdbStatus');
    if (status && status.parentNode) status.parentNode.insertBefore(b, status.nextSibling);
    return b;
  }

  function updateStorageBanner(){
    const b = ensureStorageBanner();
    const stand = isStandalone();
    const token = !!tmdbGetKey();
    const added = addedItems.length;
    const meta = Object.keys(tmdbMeta || {}).length;

    if (!stand) {
      b.innerHTML = `<span>🌐 Браузерная копия · добавлено: <b>${added}</b> · TMDB-кэш: <b>${meta}</b> · токен: <b>${token?'✓':'нет'}</b>. Для ярлыка используй «📤 Экспорт» → полная копия.</span>`;
      return;
    }

    b.innerHTML = `<span>📲 <b>Установленная PWA-копия</b> · добавлено: <b>${added}</b> · TMDB-кэш: <b>${meta}</b> · токен: <b>${token?'✓':'нет'}</b>${(!token && added===0 && meta===0)?' · Похоже, данные из Safari ещё не перенесены.':''}</span>
      <label class="btn" style="cursor:pointer">📥 Перенести JSON
        <input id="v56QuickImport" type="file" accept=".json,application/json" style="display:none">
      </label>`;
    const input = b.querySelector('#v56QuickImport');
    if (input) input.onchange = e => importPortableFile(e.target.files[0]);
  }

  const updateBtn = document.getElementById('updateAppBtn');
  if (updateBtn) {
    updateBtn.onclick = async () => {
      toast('Обновляю приложение…');
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) {
            try { await r.update(); } catch(e) {}
          }
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.filter(k => /^watchlist-v/i.test(k) && k !== 'watchlist-v5-6').map(k => caches.delete(k)));
        }
      } catch(e) {
        console.warn('Update cleanup', e);
      }
      const u = new URL(location.href);
      u.searchParams.set('appv', '56-' + Date.now());
      location.replace(u.toString());
    };
  }

  injectV56Styles();
  setVersionLabels();
  updateStorageBanner();
  updateTmdbStatusV56();
  render();

  // v5.6 resumes incomplete TMDB enrichment even when some metadata
  // already exists. This is the key change from v5.5.
  setTimeout(() => {
    if (tmdbGetKey()) {
      const missing = (listMode === 'personal' ? addedItems : [...DATA.movies, ...DATA.series, ...addedItems])
        .some(itemNeedsTmdb);
      if (missing) refreshExistingFromTmdb({silent:true});
    }
  }, 1600);

  console.info('Watchlist v5.6 patch active', {
    standalone: isStandalone(),
    addedItems: addedItems.length,
    tmdbMeta: Object.keys(tmdbMeta || {}).length,
    hasTmdbToken: !!tmdbGetKey()
  });
})();
