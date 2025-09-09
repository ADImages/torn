// ==UserScript==
// @name         Torn Target Lists
// @namespace    ab.torn.tools
// @version      1.0.0
// @description  Curated links panel under the Targets list
// @match        https://www.torn.com/page.php?sid=list&type=targets*
// @run-at       document-idle
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;

  const FEED_URL = 'https://script.google.com/macros/s/AKfycbwyMOMS4q2mRz2yX_ArwzV_A3O-IGqjLyETxAafgec1BznQEaNVYdqi-eGQmL5rXe6JjA/exec';
  const CACHE_KEY = 'tgt_links_cache_v1';
  const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h
  const state = { hasLoaded:false, loading:false };

  // ---------- Page / theme ----------
  function onTargetsPage() {
    try {
      const u = new URL(location.href);
      return u.pathname.endsWith('/page.php') && u.searchParams.get('sid') === 'list' && (u.searchParams.get('type') || '') === 'targets';
    } catch { return false; }
  }
  function isDarkMode() {
    const cls = (document.documentElement.className + ' ' + document.body.className).toLowerCase();
    if (/\b(dark|darkmode|theme-dark)\b/.test(cls)) return true;
    const bg = getComputedStyle(document.body).backgroundColor || '';
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (m) { const [r,g,b] = m.slice(1).map(Number); const L = 0.2126*r + 0.7152*g + 0.0722*b; return L < 140; }
    return false;
  }

  // ---------- Robust anchoring (below filter/search) ----------
  function findFilterBlock() {
    const scope = document.querySelector('#mainContainer') || document;
    const search = scope.querySelector('input[placeholder*="targets list" i]') ||
                   scope.querySelector('input[placeholder*="search" i]');
    if (search) {
      let p = search;
      for (let i=0; i<5 && p; i++) {
        const idcl = ((p.className||'') + ' ' + (p.id||'')).toLowerCase();
        if (/search|filter|radio/.test(idcl)) return p;
        p = p.parentElement;
      }
    }
    const radios = Array.from((document.querySelector('#mainContainer')||document).querySelectorAll('label, span, div'))
      .find(el => /All/i.test(el.textContent||'') && /Okay/i.test(el.textContent||'') && /Traveling/i.test(el.textContent||''));
    return radios ? radios.parentElement : null;
  }
  function findListAfterFilter() {
    const scope = document.querySelector('#mainContainer') || document;
    const filter = findFilterBlock();
    const fRect = filter ? filter.getBoundingClientRect() : null;
    const candidates = Array.from(scope.querySelectorAll('.table-cont, .table, [class*="table"], table'));
    let best = null, bestScore = -1;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 500 || rect.height < 40) continue;
      if (fRect && rect.top <= fRect.bottom + 5) continue; // must be below filter
      const txt = (el.textContent || '').toLowerCase();
      let score = 0;
      if (txt.includes('name')) score++;
      if (txt.includes('level')) score++;
      if (txt.includes('description')) score++;
      if (txt.includes('status')) score += 2;
      score += Math.min(2, Math.floor(rect.width / 400));
      score += Math.min(2, Math.floor(rect.top / 300));
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
  }
  function waitForListBlock(timeoutMs = 6000) {
    const found = findListAfterFilter();
    if (found) return Promise.resolve(found);
    return new Promise(resolve => {
      const start = Date.now();
      const mo = new MutationObserver(() => {
        const t = findListAfterFilter();
        if (t) { mo.disconnect(); resolve(t); }
        else if (Date.now() - start > timeoutMs) { mo.disconnect(); resolve(null); }
      });
      mo.observe(document, { childList: true, subtree: true });
    });
  }
  function reanchorPanel() {
    const table = findListAfterFilter();
    const panel = document.getElementById('tgt-curated');
    const footer = document.getElementById('tgt-updated-out');
    if (!table || !panel) return;
    if (table.nextElementSibling !== panel) {
      table.insertAdjacentElement('afterend', panel);
      if (footer) { panel.insertAdjacentElement('afterend', footer); }
    }
  }

  // ---------- Styles ----------
  function ensureStyles() {
    if (document.getElementById('tgt-curated-style')) return;
    const s = document.createElement('style'); s.id = 'tgt-curated-style';
    s.textContent = `
      #tgt-curated{margin:12px 0;border-radius:8px;border:1px solid;overflow:hidden;width:100%;box-sizing:border-box;display:block}
      #tgt-curated .tgt-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;font-weight:700;background-image:var(--default-panel-gradient)!important}
      #tgt-curated .tgt-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #tgt-curated .tgt-actions a{font-weight:600;text-decoration:none;cursor:pointer}
      #tgt-curated .tgt-body{padding:8px 10px;display:grid;gap:12px}
      #tgt-curated .tgt-group h4{margin:0 0 6px;font-size:12px;opacity:.9}
      #tgt-curated .tgt-list{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:8px}
      #tgt-curated .tgt-item{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;border:1px solid}
      #tgt-curated .tgt-item a{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none}
      #tgt-curated .tgt-item a:hover{text-decoration:underline}
      #tgt-curated .host{font-size:10px;opacity:.75;text-align:right}
      #tgt-updated-out{margin:6px 2px 0 2px;font-size:11px}
      #tgt-updated-out.theme-light{color:#525252}
      #tgt-updated-out.theme-dark{color:#c9ced6}
      /* Light */
      #tgt-curated.theme-light{--default-panel-gradient:linear-gradient(180deg,#fff 0%,#ddd 100%);background:#f2f2f2;border-color:#cfd3d7;color:#222}
      #tgt-curated.theme-light .tgt-head{color:#222;border-bottom:1px solid #cfd3d7}
      #tgt-curated.theme-light .tgt-item{background:#e1e1e1;border-color:#bdbdbd}
      #tgt-curated.theme-light a,#tgt-curated.theme-light .tgt-actions a{color:#444444}
      /* Dark */
      #tgt-curated.theme-dark{--default-panel-gradient:linear-gradient(180deg,#555 0%,#333 100%);background:#333333;border-color:#444;color:#e5e7eb}
      #tgt-curated.theme-dark .tgt-head{color:#e5e7eb;border-bottom:1px solid #444}
      #tgt-curated.theme-dark .tgt-item{background:#191919;border-color:#444}
      #tgt-curated.theme-dark a,#tgt-curated.theme-dark .tgt-actions a{color:#dddddd}
    `;
    document.head.appendChild(s);
  }

  // ---------- Utils ----------
  function hostFromURL(u){ try{ return new URL(u).host.replace(/^www\./,''); }catch{ return ''; } }
  function escapeHTML(s){ const map={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}; return String(s||'').replace(/[&<>"']/g,m=>map[m]); }
  function escapeAttr(s){ const map={'&':'&amp;','"':'&quot;',"'":'&#39;','<':'&lt;','>':'&gt;'}; return String(s||'').replace(/[&"'<>]/g,m=>map[m]); }

  // ---------- Network ----------
  function gmFetchJSON(url) {
    return new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method: 'GET', url, headers: { 'Accept': 'application/json' },
        onload: (res) => { try { resolve(JSON.parse(res.responseText)); } catch { reject(new Error('Invalid JSON from feed')); } },
        onerror: () => reject(new Error('Network error')), ontimeout: () => reject(new Error('Request timed out'))
      });
    });
  }

  // ---------- Data load (cache) ----------
  async function loadLinks(force = false) {
    const now = Date.now();
    if (!force) {
      const cached = await GM.getValue(CACHE_KEY);
      if (cached) {
        const obj = JSON.parse(cached);
        if (obj && obj.ts && (now - obj.ts) < CACHE_TTL_MS && Array.isArray(obj.links)) {
          return { links: obj.links, updated: obj.updated || '', fromCache: true };
        }
      }
    }
    const data = await gmFetchJSON(FEED_URL);
    const raw = Array.isArray(data?.links) ? data.links : [];
    const links = raw
      .map(x => ({
        label: String(x.label || '').trim(),
        url: String(x.url || '').trim(),
        group: (String(x.group || '') || (/torn\.com\/forums\.php/i.test(x.url) ? 'forum' : 'other')).toLowerCase()
      }))
      .filter(x => x.label && x.url && (x.group === 'forum' || x.group === 'other'));
    const updated = data?.updated || new Date().toISOString();
    await GM.setValue(CACHE_KEY, JSON.stringify({ ts: now, updated, links }));
    return { links, updated, fromCache: false };
  }

  // ---------- Grouping + A→Z sort ----------
  function bucketize(links){
    const forum = [], other = [];
    for (const it of links) { (/^forum$/i.test(it.group) ? forum : other).push(it); }
    const cmp = (a,b)=>String(a.label||'').localeCompare(String(b.label||''), undefined, {sensitivity:'base'});
    forum.sort(cmp); other.sort(cmp);
    return { forum, other };
  }

  // ---------- Rendering ----------
  function renderGroups(groups){
    const renderList = (arr) => {
      if (!arr.length) return '<div class="tgt-item">(none)</div>';
      return arr.map(it =>
        '<div class="tgt-item">'
        + '<a href="'+escapeAttr(it.url)+'" target="_blank" rel="noopener" title="'+escapeAttr(it.label || it.url)+'">'+escapeHTML(it.label||it.url)+'</a>'
        + '<span class="host">'+escapeHTML(hostFromURL(it.url))+'</span>'
        + '</div>'
      ).join('');
    };
    return [
      '<div class="tgt-group"><h4>Forum threads</h4><div class="tgt-list">'+renderList(groups.forum)+'</div></div>',
      '<div class="tgt-group"><h4>Other</h4><div class="tgt-list">'+renderList(groups.other)+'</div></div>'
    ].join('');
  }

  function setTheme(panel, footer){
    const theme = isDarkMode() ? 'theme-dark' : 'theme-light';
    if (panel) { panel.className = theme; }
    if (footer) { footer.className = theme; }
  }

  async function updateBody(force){
    if (state.loading) return;
    state.loading = true;
    const body = document.getElementById('tgt-body');
    const footer = document.getElementById('tgt-updated-out');
    try {
      if (force && body) { body.innerHTML = '<div class="tgt-item">(refreshing…)</div>'; }
      const { links, updated, fromCache } = await loadLinks(force);
      const groups = bucketize(links);
      if (body) { body.innerHTML = renderGroups(groups); }
      if (footer) {
        footer.textContent = updated
          ? `Updated ${new Date(updated).toLocaleString()}${fromCache ? ' • cached' : ''}`
          : (fromCache ? 'Cached' : '');
      }
      state.hasLoaded = true;
    } catch (e) {
      const cachedRaw = await GM.getValue(CACHE_KEY);
      if (cachedRaw) {
        const obj = JSON.parse(cachedRaw);
        const groups = bucketize(obj.links || []);
        if (body) { body.innerHTML = renderGroups(groups); }
        if (footer) { footer.textContent = obj.updated ? `Cached ${new Date(obj.updated).toLocaleString()}` : 'Cached'; }
      } else {
        if (body) { body.innerHTML = '<div class="tgt-item">(failed to load links)</div>'; }
        if (footer) { footer.textContent = 'Error loading links'; }
      }
    } finally {
      state.loading = false;
      reanchorPanel();
    }
  }

  function buildPanel(anchor) {
    if (document.getElementById('tgt-curated')) return;
    const panel = document.createElement('div');
    panel.id='tgt-curated';
    panel.innerHTML =
      '<div class="tgt-head">'
      + '<div class="tgt-title">Target lists</div>'
      + '<div class="tgt-actions"><a href="#" id="tgt-refresh" title="Fetch latest list">Refresh</a></div>'
      + '</div>'
      + '<div class="tgt-body" id="tgt-body"><div class="tgt-item">(loading…)</div></div>';

    const footer = document.createElement('div');
    footer.id = 'tgt-updated-out';

    if (anchor && anchor.parentElement) {
      anchor.insertAdjacentElement('afterend', panel);
      panel.insertAdjacentElement('afterend', footer);
    } else {
      (document.querySelector('#mainContainer') || document.body).appendChild(panel);
      panel.insertAdjacentElement('afterend', footer);
    }

    setTheme(panel, footer);
    panel.querySelector('#tgt-refresh').addEventListener('click', async (e)=>{
      e.preventDefault();
      await updateBody(true);
    });
  }

  async function initOnce() {
    if (!onTargetsPage()) return;
    ensureStyles();
    const anchor = await waitForListBlock();
    buildPanel(anchor);
    if (!state.hasLoaded) { await updateBody(false); }
  }

  // Debounced watcher: keep theme/anchor correct
  let debounce = null;
  const obs = new MutationObserver(() => {
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      const panel = document.getElementById('tgt-curated');
      const footer = document.getElementById('tgt-updated-out');
      setTheme(panel, footer);
      reanchorPanel();
    }, 250);
  });
  obs.observe(document, { childList: true, subtree: true });

  initOnce();
})();
