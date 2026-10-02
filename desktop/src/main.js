import './styles.css';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';

// Firebase Web Config 可安全存在前端；不要在此放 Admin SDK / Service Account 私鑰。
const firebaseConfig = {
  apiKey: 'AIzaSyAdFJeGDJI9IxRZ9_k2ssOP9Ns3DL6Nhlg',
  authDomain: 'deer-7327a.firebaseapp.com',
  projectId: 'deer-7327a',
  storageBucket: 'deer-7327a.firebasestorage.app',
  messagingSenderId: '772101073013',
  appId: '1:772101073013:web:098e979cb896d2f633b03c',
  measurementId: 'G-CE68YLW648'
};

const COLLECTION_NAME = 'research_dictionary';
const PRIVATE_ROOT = 'user_research_dictionary';
const LOGIN_SESSION_COLLECTION = 'desktop_login_sessions';
const ADMIN_UID = 'KMKNZedIqZZ4kx4l3dDCSqMxYCZ2';
const CACHE_KEY = 'research_dictionary_desktop_cache_v1';
const SHORTCUT_KEY = 'research_dictionary_desktop_shortcuts_v1';
const THEME_KEY = 'research_dictionary_desktop_theme_v1';
const UPDATE_CHECK_KEY = 'research_dictionary_desktop_update_check_v1';
const LAST_UPDATE_CHECK_KEY = 'research_dictionary_desktop_last_update_check_v1';
const FONT_SCALE_KEY = 'research_dictionary_desktop_font_scale_v1';
const DEFAULT_SHORTCUTS = Object.freeze({
  lookup: 'Ctrl+Shift+D',
  search: 'Ctrl+Alt+D'
});

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const appWindow = getCurrentWindow();

let publicTerms = [];
let privateTerms = [];
let terms = [];
let currentUser = null;
let searchText = '';
let selectedTerm = null;
let loading = true;
let sourceState = 'loading';
let categoryFilter = '';
let statusFilter = '';
let scopeFilter = 'all';
let editorOpen = false;
let editingTerm = null;
let loginPending = false;
let loginSessionId = '';
let loginPollTimer = null;
let loginMessage = '';
let updateInfo = null;
let updateChecking = false;
let updateInstalling = false;
let autoUpdateCheck = localStorage.getItem(UPDATE_CHECK_KEY) !== 'false';
let appVersion = '0.0.0';
let settingsOpen = false;
let shortcutConfig = loadShortcutConfig();
let shortcutDraft = { ...shortcutConfig };
let capturingShortcut = null;
let hotkeyState = 'loading';
let hotkeyError = '';
let toastTimer = null;
let theme = loadTheme();
let fontScale = loadFontScale();

applyTheme(theme, false);
applyFontScale(fontScale, false);

const root = document.querySelector('#app');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function normalize(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[\s\-_/·・.,，。:：;；()（）\[\]【】{}「」『』'"`]+/g, '');
}

function splitTokens(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐‑‒–—―_/·・.,，。:：;；()（）\[\]【】{}「」『』'"`]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(normalize)
    .filter(Boolean);
}

function statusInfo(status = '') {
  const map = {
    verified: ['verified', '已驗證'],
    pending: ['pending', '待確認'],
    candidate: ['candidate', '候選定義'],
    confirmed: ['verified', '已確認（舊）'],
    general: ['general', '一般詞彙（舊）']
  };
  return map[status] || ['general', status || '未設定'];
}

function scoreTerm(term, rawQuery) {
  const tokens = splitTokens(rawQuery);
  if (!tokens.length) return term.is_core ? 8 : 0;

  const fields = [
    [term.term_en, 160],
    [term.term_zh, 155],
    [term.category, 60],
    [term.simple_explanation, 48],
    [term.definition, 42],
    [term.research_note, 28],
    [term.source, 24],
    [term.sourceType, 20],
    [term.sourceDetail, 16],
    [term.example, 14]
  ].filter(([v]) => v).map(([v, weight]) => ({ value: normalize(v), weight }));

  let score = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of fields) {
      if (!field.value.includes(token)) continue;
      best = Math.max(best, field.weight + (field.value === token ? 120 : field.value.startsWith(token) ? 55 : 12));
    }
    if (!best) return -1;
    score += best;
  }

  const compact = normalize(rawQuery);
  const en = normalize(term.term_en);
  const zh = normalize(term.term_zh);
  if (compact && (compact === en || compact === zh)) score += 360;
  else if (compact && (en.startsWith(compact) || zh.startsWith(compact))) score += 150;
  else if (compact && (en.includes(compact) || zh.includes(compact))) score += 80;
  if (term.is_core) score += 5;
  return score;
}

function scopeMatches(term) {
  if (scopeFilter === 'shared') return term.is_shared !== false;
  if (scopeFilter === 'mine') return !!currentUser && term.createdBy === currentUser.uid;
  if (scopeFilter === 'private') return !!currentUser && term.createdBy === currentUser.uid && term.is_shared === false;
  return true;
}

function getResults() {
  return terms
    .map((term) => ({ term, score: scoreTerm(term, searchText) }))
    .filter(({term, score}) =>
      score >= 0 &&
      (!categoryFilter || term.category === categoryFilter) &&
      (!statusFilter || term.status === statusFilter) &&
      scopeMatches(term)
    )
    .sort((a, b) =>
      b.score - a.score ||
      Number(b.term.is_core) - Number(a.term.is_core) ||
      String(a.term.term_en || '').localeCompare(String(b.term.term_en || ''))
    )
    .slice(0, searchText ? 60 : 36)
    .map((x) => x.term);
}

function categories() {
  return [...new Set(terms.map((t) => String(t.category || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

function mergeTerms() {
  const merged = new Map();
  publicTerms.forEach((term) => merged.set(term.id, { ...term, is_shared: true, _origin: 'public' }));
  privateTerms.forEach((term) => {
    const shared = merged.get(term.id);
    merged.set(term.id, { ...(shared || {}), ...term, is_shared: term.is_shared === true, _origin: 'private' });
  });
  terms = [...merged.values()];
  localStorage.setItem(CACHE_KEY, JSON.stringify(terms));
}

function canEdit(term) {
  if (!currentUser || !term) return false;
  return term.createdBy === currentUser.uid || (currentUser.uid === ADMIN_UID && term._origin === 'public');
}

function visibilityInfo(term) {
  return term?.is_shared === false ? ['private', '私人'] : ['shared', '共享'];
}

function ownerLabel(term) {
  if (currentUser && term.createdBy === currentUser.uid) return '我的詞彙';
  return term.createdByName || term.createdByEmail || '研究辭典';
}

function exactMatch(query) {
  const key = normalize(query);
  if (!key) return null;
  return terms.find((term) => normalize(term.term_en) === key || normalize(term.term_zh) === key) || null;
}

function loadShortcutConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(SHORTCUT_KEY) || 'null');
    if (saved?.lookup && saved?.search) return { lookup: saved.lookup, search: saved.search };
  } catch {}
  return { ...DEFAULT_SHORTCUTS };
}


function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(nextTheme, persist = true) {
  theme = nextTheme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  if (persist) localStorage.setItem(THEME_KEY, theme);
}

function loadFontScale() {
  const saved = Number(localStorage.getItem(FONT_SCALE_KEY));
  return Number.isFinite(saved) && saved >= 90 && saved <= 150 ? Math.round(saved / 5) * 5 : 100;
}

function applyFontScale(value, persist = true) {
  const next = Math.min(150, Math.max(90, Math.round(Number(value || 100) / 5) * 5));
  fontScale = next;
  document.documentElement.style.setProperty('--font-scale', String(next / 100));
  if (persist) localStorage.setItem(FONT_SCALE_KEY, String(next));
  return next;
}

function toggleTheme() {
  const next = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.classList.add('theme-transitioning');
  applyTheme(next);
  render();
  window.setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 360);
}

function themeIcon() {
  return theme === 'dark'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"></path></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"></path></svg>';
}

function shortcutLabel(value = '') {
  return String(value).replace(/\+/g, ' + ');
}

function hotkeyStatusLabel() {
  if (hotkeyState === 'ready') return ['ready', '快捷鍵已啟用'];
  if (hotkeyState === 'error') return ['error', '快捷鍵註冊失敗'];
  return ['loading', '快捷鍵載入中'];
}

function makeSessionId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function startDesktopLogin() {
  if (loginPending) return;
  loginPending = true;
  loginMessage = '已開啟瀏覽器，等待 Google 登入授權…';
  loginSessionId = makeSessionId();
  render();

  try {
    await invoke('open_desktop_login_url', { sessionId: loginSessionId });
  } catch (error) {
    loginPending = false;
    loginMessage = '';
    showToast('無法開啟登入頁面：' + error, true);
    render();
    return;
  }

  let attempts = 0;
  const poll = async () => {
    if (!loginPending || !loginSessionId) return;
    attempts += 1;
    try {
      const ref = doc(db, LOGIN_SESSION_COLLECTION, loginSessionId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        if (data.expiresAtMs && Date.now() > data.expiresAtMs) throw new Error('登入授權已逾時，請重新登入');
        const credential = GoogleAuthProvider.credential(
          data.googleIdToken || null,
          data.googleAccessToken || null
        );
        const result = await signInWithCredential(auth, credential);
        try { await deleteDoc(ref); } catch {}
        loginPending = false;
        loginMessage = '';
        loginSessionId = '';
        showToast('已登入 ' + (result.user.displayName || result.user.email || 'Google 帳號'));
        render();
        return;
      }
    } catch (error) {
      const text = String(error?.message || error);
      if (/permission|permissions|insufficient/i.test(text)) {
        loginPending = false;
        loginMessage = '';
        showToast('桌面登入需要先發布新版 Firestore Security Rules。', true);
        render();
        return;
      }
      console.warn('Desktop login polling:', error);
    }

    if (attempts >= 120) {
      loginPending = false;
      loginMessage = '';
      loginSessionId = '';
      showToast('登入等待逾時，請重新操作。', true);
      render();
      return;
    }
    loginPollTimer = window.setTimeout(poll, 1500);
  };

  poll();
}

function cancelDesktopLogin() {
  loginPending = false;
  loginMessage = '';
  loginSessionId = '';
  if (loginPollTimer) window.clearTimeout(loginPollTimer);
  loginPollTimer = null;
  render();
}

async function logoutDesktop() {
  cancelDesktopLogin();
  await signOut(auth);
  selectedTerm = null;
  scopeFilter = 'all';
  showToast('已登出');
}

async function checkForUpdates({ manual = false } = {}) {
  if (updateChecking || updateInstalling) return;
  if (!manual && !autoUpdateCheck) return;

  if (!manual) {
    const last = Number(localStorage.getItem(LAST_UPDATE_CHECK_KEY) || 0);
    if (Date.now() - last < 4 * 60 * 60 * 1000) return;
  }

  updateChecking = true;
  render();
  try {
    appVersion = await getVersion();
    const info = await invoke('check_for_update', { currentVersion: appVersion });
    updateInfo = info || null;
    localStorage.setItem(LAST_UPDATE_CHECK_KEY, String(Date.now()));
    if (manual) showToast(updateInfo ? ('發現新版 v' + updateInfo.version) : '目前已是最新版本');
  } catch (error) {
    console.error('Update check failed:', error);
    if (manual) showToast('檢查更新失敗：' + error, true);
  } finally {
    updateChecking = false;
    render();
  }
}

async function installAvailableUpdate() {
  if (!updateInfo || updateInstalling) return;
  updateInstalling = true;
  render();
  showToast('正在下載 v' + updateInfo.version + '，完成後會自動安裝並重新開啟。');
  try {
    await invoke('install_update', {
      downloadUrl: updateInfo.downloadUrl,
      digest: updateInfo.digest
    });
  } catch (error) {
    updateInstalling = false;
    render();
    showToast('更新失敗：' + error, true);
  }
}


function renderFilters() {
  const cats = categories();
  const statuses = [...new Set(terms.map((t) => t.status).filter(Boolean))];
  return `
    <div class="filter-row">
      <select id="categoryFilter" aria-label="分類篩選">
        <option value="">所有分類</option>
        ${cats.map((cat) => `<option value="${escapeHtml(cat)}" ${categoryFilter === cat ? 'selected' : ''}>${escapeHtml(cat)}</option>`).join('')}
      </select>
      <select id="statusFilter" aria-label="狀態篩選">
        <option value="">所有狀態</option>
        ${statuses.map((status) => {
          const [, label] = statusInfo(status);
          return `<option value="${escapeHtml(status)}" ${statusFilter === status ? 'selected' : ''}>${escapeHtml(label)}</option>`;
        }).join('')}
      </select>
      <select id="scopeFilter" aria-label="可見範圍篩選">
        <option value="all" ${scopeFilter === 'all' ? 'selected' : ''}>全部可見詞彙</option>
        <option value="shared" ${scopeFilter === 'shared' ? 'selected' : ''}>共享詞彙</option>
        ${currentUser ? `<option value="mine" ${scopeFilter === 'mine' ? 'selected' : ''}>我的詞彙</option><option value="private" ${scopeFilter === 'private' ? 'selected' : ''}>我的私人詞彙</option>` : ''}
      </select>
    </div>`;
}

function renderAccountBar() {
  if (currentUser) {
    const name = currentUser.displayName || currentUser.email || '已登入';
    const initial = (name.trim()[0] || 'U').toUpperCase();
    return `
      <div class="account-bar signed-in">
        <div class="account-user">
          <span class="avatar">${escapeHtml(initial)}</span>
          <div><strong>${escapeHtml(name)}</strong><span>私人詞彙會同步到此帳號</span></div>
        </div>
        <div class="account-actions">
          <button class="primary-btn compact" id="addTermBtn">＋ 新增詞彙</button>
          <button class="text-btn" id="logoutBtn">登出</button>
        </div>
      </div>`;
  }
  return `
    <div class="account-bar">
      <div><strong>登入後可建立自己的研究辭典</strong><span>${loginPending ? escapeHtml(loginMessage) : '可新增、修改私人詞彙，並自行決定是否共享。'}</span></div>
      <div class="account-actions">${loginPending ? '<button class="secondary-btn" id="cancelLoginBtn">取消</button>' : '<button class="primary-btn compact" id="loginBtn">使用 Google 登入</button>'}</div>
    </div>`;
}

function updateFooterTemplate() {
  if (updateInstalling) return '<button class="update-btn" disabled>正在更新…</button>';
  if (updateInfo) return `<button class="update-btn" id="installUpdateBtn">更新至 v${escapeHtml(updateInfo.version)}</button>`;
  if (updateChecking) return '<button class="text-btn" disabled>檢查更新中…</button>';
  return `<button class="text-btn" id="checkUpdateBtn">檢查更新${appVersion !== '0.0.0' ? ` · v${escapeHtml(appVersion)}` : ''}</button>`;
}

function render() {
  const results = getResults();
  const current = selectedTerm;
  const sourceLabel = sourceState === 'online' ? 'Firestore 已同步' : sourceState === 'cache' ? '離線快取' : sourceState === 'error' ? '無法連線' : '載入中';
  const [hotkeyClass, hotkeyLabel] = hotkeyStatusLabel();

  root.innerHTML = `
    <main class="shell app-enter">
      <header class="titlebar" id="titlebar">
        <div class="brand">
          <div class="logo">RD</div>
          <div><strong>Research Dictionary</strong><span>Windows 研究辭典</span></div>
        </div>
        <div class="window-actions">
          <button class="icon-button theme-button" id="themeBtn" title="切換明暗模式" aria-label="切換明暗模式">${themeIcon()}</button>
          <button class="icon-button settings-icon" id="settingsBtn" title="設定" aria-label="設定">⚙</button>
          <button class="icon-button" id="minimizeBtn" title="最小化" aria-label="最小化">—</button>
          <button class="icon-button close-button" id="closeBtn" title="關閉視窗（保留在系統匣）" aria-label="關閉視窗">×</button>
        </div>
      </header>

      <section class="search-section">
        <div class="search-box">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>
          <input id="searchInput" autocomplete="off" spellcheck="false" placeholder="搜尋詞彙、定義、分類、來源…" value="${escapeHtml(searchText)}" />
          ${searchText ? '<button id="clearBtn" class="clear-btn" aria-label="清除搜尋">×</button>' : `<kbd>${escapeHtml(shortcutLabel(shortcutConfig.search))}</kbd>`}
        </div>
        <div class="helper-row">
          <span><b>${escapeHtml(shortcutLabel(shortcutConfig.lookup))}</b> 查詢目前反白文字</span>
          <div class="status-cluster">
            <span class="shortcut-state ${hotkeyClass}" title="${escapeHtml(hotkeyError)}"><i></i>${hotkeyLabel}</span>
            <span class="sync ${sourceState}"><i></i>${sourceLabel}</span>
          </div>
        </div>
        ${renderFilters()}
        ${renderAccountBar()}
      </section>

      ${current ? detailTemplate(current) : listTemplate(results)}

      <footer class="footer">
        <label class="autostart"><input id="autostartToggle" type="checkbox" /> Windows 開機時啟動</label>
        <div class="footer-actions">
          ${updateFooterTemplate()}
          <button class="text-btn" id="refreshBtn">重新同步</button>
          <button class="text-btn" id="websiteBtn">網站</button>
        </div>
      </footer>

      ${settingsOpen ? settingsTemplate() : ''}
      ${editorOpen ? editorTemplate() : ''}
      <div id="toast" class="toast" aria-live="polite"></div>
    </main>
  `;

  wireEvents();
}

function listTemplate(results) {
  if (loading) {
    return `<section class="content"><div class="empty"><div class="spinner"></div><strong>正在讀取研究辭典</strong><span>同步共享詞彙與你的私人詞彙。</span></div></section>`;
  }
  if (!results.length) {
    return `<section class="content"><div class="empty"><div class="empty-icon">?</div><strong>找不到符合條件的詞彙</strong><span>${searchText ? `沒有找到「${escapeHtml(searchText)}」` : '請調整分類、狀態或顯示範圍。'}</span>${currentUser ? '<button class="primary-btn" id="emptyAddBtn">＋ 新增詞彙</button>' : ''}</div></section>`;
  }

  return `
    <section class="content">
      <div class="result-head"><strong>${searchText ? `找到 ${results.length} 個結果` : `顯示 ${results.length} 個詞彙`}</strong><span>${terms.length} 個可用詞彙</span></div>
      <div class="term-list">
        ${results.map((term, index) => {
          const [statusClass, statusLabel] = statusInfo(term.status);
          const [visibilityClass, visibilityText] = visibilityInfo(term);
          return `
            <article class="term-card term-enter" style="--delay:${Math.min(index, 14) * 20}ms">
              <button class="term-open" data-term-id="${escapeHtml(term.id)}">
                <div class="term-card-head">
                  <div class="term-main">
                    <div class="term-title"><strong>${escapeHtml(term.term_en || '未命名')}</strong>${term.is_core ? '<span class="core">核心</span>' : ''}</div>
                    <div class="term-zh">${escapeHtml(term.term_zh || '')}</div>
                  </div>
                  <div class="term-badges">
                    <span class="visibility ${visibilityClass}">${visibilityText}</span>
                    <span class="status ${statusClass}">${escapeHtml(statusLabel)}</span>
                  </div>
                </div>
                <div class="meta-line">
                  <span>${escapeHtml(term.category || '未分類')}</span>
                  ${term.sourceType ? `<span>${escapeHtml(term.sourceType)}</span>` : ''}
                  <span>${escapeHtml(ownerLabel(term))}</span>
                </div>
                <p class="term-simple">${escapeHtml(term.simple_explanation || '尚無白話解釋')}</p>
                <p class="term-definition">${escapeHtml(term.definition || '')}</p>
                ${term.source ? `<div class="source-preview">來源：${escapeHtml(term.source)}</div>` : ''}
              </button>
              ${canEdit(term) ? `<div class="card-actions"><button class="small-btn" data-edit-term="${escapeHtml(term.id)}">編輯</button><button class="small-btn danger" data-delete-term="${escapeHtml(term.id)}">刪除</button></div>` : ''}
            </article>`;
        }).join('')}
      </div>
    </section>`;
}

function detailTemplate(term) {
  const [statusClass, statusLabel] = statusInfo(term.status);
  const [visibilityClass, visibilityText] = visibilityInfo(term);
  return `
    <section class="content detail-view detail-enter">
      <div class="detail-toolbar">
        <button class="back-btn" id="backBtn">← 返回</button>
        ${canEdit(term) ? '<div><button class="small-btn" id="detailEditBtn">編輯</button><button class="small-btn danger" id="detailDeleteBtn">刪除</button></div>' : ''}
      </div>
      <div class="detail-card">
        <div class="detail-heading">
          <div><h1>${escapeHtml(term.term_en || '')}</h1><h2>${escapeHtml(term.term_zh || '')}</h2></div>
          <div class="detail-badges">${term.is_core ? '<span class="core">核心</span>' : ''}<span class="visibility ${visibilityClass}">${visibilityText}</span><span class="status ${statusClass}">${escapeHtml(statusLabel)}</span></div>
        </div>
        <div class="detail-meta"><span>${escapeHtml(term.category || '未分類')}</span><span>${escapeHtml(ownerLabel(term))}</span></div>
        ${detailBlock('正式定義', term.definition)}
        ${detailBlock('白話解釋', term.simple_explanation, true)}
        ${detailBlock('例子', term.example)}
        ${detailBlock('與研究的關係', term.research_note)}
        <div class="source-box">
          <div><span>來源</span><strong>${escapeHtml(term.source || '未填寫')}</strong></div>
          ${term.sourceType ? `<div><span>來源類型</span><strong>${escapeHtml(term.sourceType)}</strong></div>` : ''}
          ${term.sourceDetail ? `<div><span>來源位置</span><strong>${escapeHtml(term.sourceDetail)}</strong></div>` : ''}
        </div>
      </div>
    </section>`;
}

function detailBlock(title, content, emphasized = false) {
  if (!content) return '';
  return `<div class="detail-block ${emphasized ? 'emphasized' : ''}"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(content)}</p></div>`;
}

function editorTemplate() {
  const term = editingTerm || {};
  const isShared = editingTerm ? term.is_shared !== false : false;
  const cats = categories();

  return `
    <div class="modal-backdrop editor-enter" id="editorBackdrop">
      <section class="editor-panel panel-enter" role="dialog" aria-modal="true" aria-labelledby="editorTitle">
        <div class="settings-head">
          <div><span class="settings-eyebrow">${editingTerm ? 'EDIT TERM' : 'NEW TERM'}</span><h2 id="editorTitle">${editingTerm ? '編輯研究詞彙' : '新增研究詞彙'}</h2></div>
          <button class="icon-button" id="editorCloseBtn" aria-label="關閉">×</button>
        </div>
        <form id="termEditorForm">
          <div class="form-grid two">
            <label>英文名稱<input name="term_en" required value="${escapeHtml(term.term_en || '')}" placeholder="例如：Retrieval-Augmented Generation"></label>
            <label>中文名稱<input name="term_zh" required value="${escapeHtml(term.term_zh || '')}" placeholder="例如：檢索增強生成"></label>
          </div>
          <div class="form-grid two">
            <label>分類
              <input name="category" list="desktopCategoryList" value="${escapeHtml(term.category || '')}" placeholder="可輸入任何研究分類">
              <datalist id="desktopCategoryList">${cats.map((cat) => `<option value="${escapeHtml(cat)}"></option>`).join('')}</datalist>
            </label>
            <label>狀態
              <select name="status">
                ${[
                  ['verified','已驗證'],
                  ['pending','待確認'],
                  ['candidate','候選定義'],
                  ['confirmed','已確認（舊）'],
                  ['general','一般詞彙（舊）']
                ].map(([value,label]) => `<option value="${value}" ${(term.status || 'pending') === value ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </label>
          </div>
          <label>正式定義<textarea name="definition" required rows="4">${escapeHtml(term.definition || '')}</textarea></label>
          <label>白話解釋<textarea name="simple_explanation" required rows="3">${escapeHtml(term.simple_explanation || '')}</textarea></label>
          <label>例子<textarea name="example" rows="3">${escapeHtml(term.example || '')}</textarea></label>
          <label>與研究的關係<textarea name="research_note" rows="3">${escapeHtml(term.research_note || '')}</textarea></label>
          <div class="form-grid two">
            <label>來源<input name="source" value="${escapeHtml(term.source || '')}" placeholder="論文、計畫書、文件…"></label>
            <label>來源類型<input name="sourceType" value="${escapeHtml(term.sourceType || '')}" placeholder="Paper / Hou Thesis / Project Plan…"></label>
          </div>
          <label>來源位置<input name="sourceDetail" value="${escapeHtml(term.sourceDetail || '')}" placeholder="章節、頁碼；不確定可留空"></label>
          <div class="editor-checks">
            <label class="check-row"><input name="is_core" type="checkbox" ${term.is_core ? 'checked' : ''}><span>核心詞彙</span></label>
            <label class="check-row share-check"><input name="is_shared" type="checkbox" ${isShared ? 'checked' : ''}><span><strong>共享給其他使用者</strong><small>未勾選時只有你的帳號看得到。</small></span></label>
          </div>
          <div class="modal-actions">
            <button type="button" class="secondary-btn" id="editorCancelBtn">取消</button>
            <button type="submit" class="primary-btn compact">${editingTerm ? '儲存修改' : '新增詞彙'}</button>
          </div>
        </form>
      </section>
    </div>`;
}

function settingsTemplate() {
  const [hotkeyClass, hotkeyLabel] = hotkeyStatusLabel();
  return `
    <div class="modal-backdrop settings-enter" id="settingsBackdrop">
      <section class="settings-panel panel-enter" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
        <div class="settings-head">
          <div><span class="settings-eyebrow">APP SETTINGS</span><h2 id="settingsTitle">桌面程式設定</h2></div>
          <button class="icon-button" id="settingsCloseBtn" aria-label="關閉設定">×</button>
        </div>

        <p class="settings-note">設定會儲存在這台電腦，不會改動 Firestore 詞彙資料。</p>

        <div class="font-scale-setting">
          <div><strong>字體大小</strong><span>立即調整整個桌面辭典的文字比例。</span></div>
          <div class="font-scale-editor"><input id="fontScaleSlider" type="range" min="90" max="150" step="5" value="${fontScale}"><output id="fontScaleValue">${fontScale}%</output></div>
        </div>

        <div class="shortcut-setting-row">
          <div><strong>查詢目前反白文字</strong><span>選取 PDF／網頁文字後呼叫辭典</span></div>
          <div class="shortcut-editor"><kbd>${escapeHtml(shortcutLabel(shortcutDraft.lookup))}</kbd><button class="small-btn ${capturingShortcut === 'lookup' ? 'recording' : ''}" data-capture-shortcut="lookup">${capturingShortcut === 'lookup' ? '請按快捷鍵…' : '錄製'}</button></div>
        </div>

        <div class="shortcut-setting-row">
          <div><strong>開啟手動搜尋</strong><span>隨時顯示研究辭典搜尋框</span></div>
          <div class="shortcut-editor"><kbd>${escapeHtml(shortcutLabel(shortcutDraft.search))}</kbd><button class="small-btn ${capturingShortcut === 'search' ? 'recording' : ''}" data-capture-shortcut="search">${capturingShortcut === 'search' ? '請按快捷鍵…' : '錄製'}</button></div>
        </div>

        <label class="update-setting">
          <input id="autoUpdateCheck" type="checkbox" ${autoUpdateCheck ? 'checked' : ''}>
          <span><strong>自動偵測新版</strong><small>啟動後與每 4 小時自動檢查 GitHub Release。</small></span>
        </label>

        <div class="settings-status ${hotkeyClass}"><i></i><span>${hotkeyLabel}${hotkeyError ? `：${escapeHtml(hotkeyError)}` : ''}</span></div>

        <div class="settings-actions">
          <button class="secondary-btn" id="resetShortcutBtn">恢復預設快捷鍵</button>
          <div><button class="secondary-btn" id="cancelSettingsBtn">取消</button><button class="primary-btn compact" id="saveShortcutBtn">儲存並套用</button></div>
        </div>
      </section>
    </div>`;
}

function wireEvents() {
  const input = document.querySelector('#searchInput');
  if (input) {
    input.addEventListener('input', () => {
      searchText = input.value;
      selectedTerm = null;
      render();
      requestAnimationFrame(() => {
        const next = document.querySelector('#searchInput');
        next?.focus();
        next?.setSelectionRange(next.value.length, next.value.length);
      });
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const results = getResults();
        if (results.length) { selectedTerm = results[0]; render(); }
      }
    });
  }

  document.querySelector('#clearBtn')?.addEventListener('click', () => {
    searchText = '';
    selectedTerm = null;
    render();
    setTimeout(() => document.querySelector('#searchInput')?.focus(), 0);
  });

  document.querySelector('#categoryFilter')?.addEventListener('change', (event) => {
    categoryFilter = event.target.value;
    selectedTerm = null;
    render();
  });
  document.querySelector('#statusFilter')?.addEventListener('change', (event) => {
    statusFilter = event.target.value;
    selectedTerm = null;
    render();
  });
  document.querySelector('#scopeFilter')?.addEventListener('change', (event) => {
    scopeFilter = event.target.value;
    selectedTerm = null;
    render();
  });

  document.querySelector('#loginBtn')?.addEventListener('click', startDesktopLogin);
  document.querySelector('#cancelLoginBtn')?.addEventListener('click', cancelDesktopLogin);
  document.querySelector('#logoutBtn')?.addEventListener('click', logoutDesktop);
  document.querySelector('#addTermBtn')?.addEventListener('click', () => {
    editingTerm = null;
    editorOpen = true;
    render();
  });
  document.querySelector('#emptyAddBtn')?.addEventListener('click', () => {
    editingTerm = null;
    editorOpen = true;
    render();
  });

  const titlebar = document.querySelector('#titlebar');
  titlebar?.addEventListener('mousedown', async (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    try { await appWindow.startDragging(); } catch (error) { console.error('startDragging failed:', error); }
  });

  document.querySelector('#minimizeBtn')?.addEventListener('click', minimizeWindow);
  document.querySelector('#closeBtn')?.addEventListener('click', hideWindow);
  document.querySelector('#settingsBtn')?.addEventListener('click', openSettings);
  const fontSlider = document.querySelector('#fontScaleSlider');
  if (fontSlider) {
    fontSlider.addEventListener('input', () => {
      const next = applyFontScale(fontSlider.value);
      const value = document.querySelector('#fontScaleValue');
      if (value) value.textContent = `${next}%`;
    });
  }
  document.querySelector('#themeBtn')?.addEventListener('click', toggleTheme);
  document.querySelector('#backBtn')?.addEventListener('click', () => {
    selectedTerm = null;
    render();
    setTimeout(() => document.querySelector('#searchInput')?.focus(), 0);
  });
  document.querySelector('#refreshBtn')?.addEventListener('click', () => loadTerms(true));
  document.querySelector('#websiteBtn')?.addEventListener('click', openWebsite);
  document.querySelectorAll('[data-term-id]').forEach((el) => el.addEventListener('click', () => {
    selectedTerm = terms.find((t) => t.id === el.dataset.termId) || null;
    render();
  }));
  document.querySelectorAll('[data-edit-term]').forEach((el) => el.addEventListener('click', () => {
    editingTerm = terms.find((t) => t.id === el.dataset.editTerm) || null;
    editorOpen = true;
    render();
  }));
  document.querySelectorAll('[data-delete-term]').forEach((el) => el.addEventListener('click', () => {
    const term = terms.find((t) => t.id === el.dataset.deleteTerm);
    if (term) deleteTerm(term);
  }));
  document.querySelector('#detailEditBtn')?.addEventListener('click', () => {
    editingTerm = selectedTerm;
    editorOpen = true;
    render();
  });
  document.querySelector('#detailDeleteBtn')?.addEventListener('click', () => {
    if (selectedTerm) deleteTerm(selectedTerm);
  });

  document.querySelector('#editorCloseBtn')?.addEventListener('click', () => {
    editorOpen = false;
    editingTerm = null;
    render();
  });
  document.querySelector('#editorCancelBtn')?.addEventListener('click', () => {
    editorOpen = false;
    editingTerm = null;
    render();
  });
  document.querySelector('#editorBackdrop')?.addEventListener('mousedown', (event) => {
    if (event.target.id === 'editorBackdrop') {
      editorOpen = false;
      editingTerm = null;
      render();
    }
  });
  document.querySelector('#termEditorForm')?.addEventListener('submit', saveEditor);

  document.querySelector('#settingsCloseBtn')?.addEventListener('click', closeSettings);
  document.querySelector('#cancelSettingsBtn')?.addEventListener('click', closeSettings);
  document.querySelector('#settingsBackdrop')?.addEventListener('mousedown', (e) => {
    if (e.target.id === 'settingsBackdrop') closeSettings();
  });
  document.querySelectorAll('[data-capture-shortcut]').forEach((btn) => btn.addEventListener('click', () => {
    capturingShortcut = btn.dataset.captureShortcut;
    render();
  }));
  document.querySelector('#resetShortcutBtn')?.addEventListener('click', () => {
    shortcutDraft = { ...DEFAULT_SHORTCUTS };
    capturingShortcut = null;
    render();
  });
  document.querySelector('#saveShortcutBtn')?.addEventListener('click', saveShortcutSettings);
  document.querySelector('#autoUpdateCheck')?.addEventListener('change', (event) => {
    autoUpdateCheck = event.target.checked;
    localStorage.setItem(UPDATE_CHECK_KEY, String(autoUpdateCheck));
  });
  document.querySelector('#checkUpdateBtn')?.addEventListener('click', () => checkForUpdates({ manual: true }));
  document.querySelector('#installUpdateBtn')?.addEventListener('click', installAvailableUpdate);

  const auto = document.querySelector('#autostartToggle');
  if (auto) {
    isAutostartEnabled().then((v) => auto.checked = v).catch(() => {});
    auto.addEventListener('change', async () => {
      try {
        if (auto.checked) await enableAutostart(); else await disableAutostart();
      } catch (error) {
        auto.checked = !auto.checked;
        showToast(`開機啟動設定失敗：${error}`, true);
      }
    });
  }
}

async function saveEditor(event) {
  event.preventDefault();
  if (!currentUser) {
    showToast('請先登入才能新增或修改詞彙。', true);
    return;
  }

  const wasEditing = !!editingTerm;
  const original = editingTerm;
  const data = new FormData(event.currentTarget);
  const payload = {
    term_en: String(data.get('term_en') || '').trim(),
    term_zh: String(data.get('term_zh') || '').trim(),
    category: String(data.get('category') || '').trim() || '未分類',
    status: String(data.get('status') || 'pending'),
    definition: String(data.get('definition') || '').trim(),
    simple_explanation: String(data.get('simple_explanation') || '').trim(),
    example: String(data.get('example') || '').trim(),
    research_note: String(data.get('research_note') || '').trim(),
    source: String(data.get('source') || '').trim(),
    sourceType: String(data.get('sourceType') || '').trim(),
    sourceDetail: String(data.get('sourceDetail') || '').trim(),
    is_core: data.get('is_core') === 'on',
    is_shared: data.get('is_shared') === 'on'
  };

  if (!payload.term_en || !payload.term_zh || !payload.definition || !payload.simple_explanation) {
    showToast('英文名稱、中文名稱、正式定義與白話解釋為必填。', true);
    return;
  }

  const duplicate = terms.find((term) =>
    term.id !== original?.id &&
    (normalize(term.term_en) === normalize(payload.term_en) || normalize(term.term_zh) === normalize(payload.term_zh))
  );
  if (duplicate) {
    showToast('已有相同詞彙：' + duplicate.term_en + '｜' + duplicate.term_zh, true);
    return;
  }

  try {
    const uid = currentUser.uid;
    const isAdminEditingOther = original && original.createdBy !== uid && uid === ADMIN_UID && original._origin === 'public';

    if (isAdminEditingOther) {
      await updateDoc(doc(db, COLLECTION_NAME, original.id), {
        ...payload,
        is_shared: true,
        updatedAt: serverTimestamp()
      });
    } else {
      if (original && original.createdBy && original.createdBy !== uid) {
        throw new Error('你只能修改自己建立的詞彙');
      }

      const termId = original?.id || doc(collection(db, PRIVATE_ROOT, uid, 'terms')).id;
      const personalRef = doc(db, PRIVATE_ROOT, uid, 'terms', termId);
      const publicRef = doc(db, COLLECTION_NAME, termId);
      const createdAt = original?.createdAt || serverTimestamp();
      const ownerData = {
        createdBy: uid,
        createdByName: currentUser.displayName || '',
        createdByEmail: currentUser.email || ''
      };
      const fullPayload = {
        ...payload,
        ...ownerData,
        createdAt,
        updatedAt: serverTimestamp()
      };

      await setDoc(personalRef, fullPayload, { merge: true });

      if (payload.is_shared) {
        await setDoc(publicRef, { ...fullPayload, is_shared: true }, { merge: true });
      } else {
        const publicCopy = publicTerms.find((term) => term.id === termId && term.createdBy === uid);
        if (publicCopy) await deleteDoc(publicRef);
      }
    }

    editorOpen = false;
    editingTerm = null;
    showToast(wasEditing ? '詞彙已更新' : '詞彙已新增');
    await loadTerms(true);
  } catch (error) {
    console.error(error);
    showToast('儲存失敗：' + (error?.message || error), true);
  }
}

async function deleteTerm(term) {
  if (!canEdit(term)) {
    showToast('你只能刪除自己建立的詞彙。', true);
    return;
  }
  if (!confirm('確定刪除「' + term.term_en + '｜' + term.term_zh + '」？')) return;

  try {
    const uid = currentUser.uid;
    if (term.createdBy !== uid && uid === ADMIN_UID && term._origin === 'public') {
      await deleteDoc(doc(db, COLLECTION_NAME, term.id));
    } else {
      await deleteDoc(doc(db, PRIVATE_ROOT, uid, 'terms', term.id)).catch(() => {});
      const publicCopy = publicTerms.find((item) => item.id === term.id && item.createdBy === uid);
      if (publicCopy) await deleteDoc(doc(db, COLLECTION_NAME, term.id));
    }
    selectedTerm = null;
    showToast('詞彙已刪除');
    await loadTerms(true);
  } catch (error) {
    showToast('刪除失敗：' + (error?.message || error), true);
  }
}

async function loadTerms(force = false) {
  loading = true;
  sourceState = 'loading';
  if (force) selectedTerm = null;
  render();
  try {
    const publicSnap = await getDocs(collection(db, COLLECTION_NAME));
    publicTerms = publicSnap.docs.map((d) => ({ id: d.id, ...d.data(), is_shared: true, _origin: 'public' }));

    if (currentUser) {
      try {
        const privateSnap = await getDocs(collection(db, PRIVATE_ROOT, currentUser.uid, 'terms'));
        privateTerms = privateSnap.docs.map((d) => ({ id: d.id, ...d.data(), _origin: 'private' }));
      } catch (privateError) {
        console.warn('Private dictionary unavailable:', privateError);
        privateTerms = [];
        const message = String(privateError?.message || privateError);
        if (/permission|permissions|insufficient/i.test(message)) {
          showToast('私人辭典需要發布新版 Firestore Security Rules。', true);
        }
      }
    } else {
      privateTerms = [];
    }

    mergeTerms();
    sourceState = 'online';
  } catch (error) {
    console.error('Firestore load failed:', error);
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        terms = JSON.parse(cached);
        sourceState = 'cache';
      } catch {
        sourceState = 'error';
      }
    } else {
      sourceState = 'error';
    }
  } finally {
    loading = false;
    render();
  }
}

async function minimizeWindow() {
  try {
    await appWindow.minimize();
  } catch (error) {
    console.error(error);
    showToast(`最小化失敗：${error}`, true);
  }
}

async function hideWindow() {
  try {
    settingsOpen = false;
    editorOpen = false;
    editingTerm = null;
    capturingShortcut = null;
    await appWindow.hide();
  } catch (error) {
    console.error(error);
    showToast(`關閉視窗失敗：${error}`, true);
  }
}

async function showSearchWindow({ focusSearch = true } = {}) {
  try { await appWindow.unminimize(); } catch {}
  await appWindow.show();
  await appWindow.setFocus();
  if (focusSearch) setTimeout(() => document.querySelector('#searchInput')?.focus(), 40);
}

async function openWebsite() {
  try {
    await invoke('open_research_website');
  } catch (error) {
    console.error('Open website failed:', error);
    showToast(`無法開啟網站：${error}`, true);
  }
}

async function lookupSelectedText() {
  if (settingsOpen || editorOpen || capturingShortcut) return;
  try {
    const captured = String(await invoke('capture_selected_text') || '').trim();
    await showSearchWindow({ focusSearch: false });
    if (!captured) {
      searchText = '';
      selectedTerm = null;
      render();
      setTimeout(() => {
        const input = document.querySelector('#searchInput');
        if (input) { input.placeholder = '沒有讀到反白文字，請直接輸入搜尋'; input.focus(); }
      }, 0);
      return;
    }

    searchText = captured.length > 180 ? captured.slice(0, 180) : captured;
    selectedTerm = exactMatch(searchText);
    if (!selectedTerm) {
      const results = getResults();
      if (results.length && scoreTerm(results[0], searchText) >= 180) selectedTerm = results[0];
    }
    render();
    if (!selectedTerm) setTimeout(() => document.querySelector('#searchInput')?.focus(), 0);
  } catch (error) {
    console.error('Capture failed:', error);
    await showSearchWindow();
    showToast(`選取文字查詢失敗：${error}`, true);
  }
}

async function registerHotkeys(config = shortcutConfig) {
  hotkeyState = 'loading';
  hotkeyError = '';
  try { await unregisterAll(); } catch {}

  try {
    await register(config.lookup, (event) => {
      if (event.state === 'Released' && !settingsOpen && !editorOpen && !capturingShortcut) lookupSelectedText();
    });
    await register(config.search, async (event) => {
      if (event.state !== 'Released' || settingsOpen || editorOpen || capturingShortcut) return;
      searchText = '';
      selectedTerm = null;
      render();
      await showSearchWindow();
    });
    hotkeyState = 'ready';
    hotkeyError = '';
  } catch (error) {
    try { await unregisterAll(); } catch {}
    hotkeyState = 'error';
    hotkeyError = String(error?.message || error || '未知錯誤');
    throw error;
  }
}

function openSettings() {
  shortcutDraft = { ...shortcutConfig };
  capturingShortcut = null;
  settingsOpen = true;
  render();
}

function closeSettings() {
  capturingShortcut = null;
  settingsOpen = false;
  render();
}

async function saveShortcutSettings() {
  const next = { ...shortcutDraft };
  if (!next.lookup || !next.search) {
    showToast('兩組快捷鍵都必須設定。', true);
    return;
  }
  if (next.lookup.toLowerCase() === next.search.toLowerCase()) {
    showToast('兩個功能不能使用相同快捷鍵。', true);
    return;
  }

  const previous = { ...shortcutConfig };
  try {
    await registerHotkeys(next);
    shortcutConfig = next;
    localStorage.setItem(SHORTCUT_KEY, JSON.stringify(shortcutConfig));
    settingsOpen = false;
    capturingShortcut = null;
    render();
    showToast('快捷鍵已更新');
  } catch (error) {
    console.error('Apply shortcuts failed:', error);
    try {
      await registerHotkeys(previous);
      shortcutConfig = previous;
    } catch {}
    settingsOpen = true;
    render();
    showToast('新快捷鍵無法註冊，可能已被其他程式占用。', true);
  }
}

function acceleratorFromEvent(e) {
  const modifiers = [];
  if (e.ctrlKey) modifiers.push('Ctrl');
  if (e.altKey) modifiers.push('Alt');
  if (e.shiftKey) modifiers.push('Shift');
  if (e.metaKey) modifiers.push('Super');

  let key = '';
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) key = e.code;
  else {
    const keyMap = {
      Space: 'Space', Enter: 'Enter', Tab: 'Tab', Escape: 'Escape',
      ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
      Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete'
    };
    key = keyMap[e.key] || '';
  }

  if (!key || ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return '';
  const isFunctionKey = /^F\d+$/.test(key);
  if (!modifiers.length && !isFunctionKey) return '';
  return [...modifiers, key].join('+');
}

function showToast(message, error = false) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => {
    const current = document.querySelector('#toast');
    if (current) current.className = 'toast';
  }, 3200);
}

window.addEventListener('keydown', (e) => {
  if (capturingShortcut) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      capturingShortcut = null;
      render();
      return;
    }
    const accelerator = acceleratorFromEvent(e);
    if (!accelerator) {
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) showToast('請使用 Ctrl／Alt／Shift 搭配按鍵，或使用 F1～F24。', true);
      return;
    }
    shortcutDraft[capturingShortcut] = accelerator;
    capturingShortcut = null;
    render();
    return;
  }

  if (e.key === 'Escape') {
    if (editorOpen) {
      editorOpen = false;
      editingTerm = null;
      render();
    } else if (settingsOpen) {
      closeSettings();
    } else if (selectedTerm) {
      selectedTerm = null;
      render();
    } else {
      hideWindow();
    }
  }
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) privateTerms = [];
  await loadTerms(true);
});

window.addEventListener('DOMContentLoaded', async () => {
  try { appVersion = await getVersion(); } catch {}
  render();
  try {
    await registerHotkeys(shortcutConfig);
  } catch (error) {
    console.error('Global shortcut registration failed:', error);
  }
  render();

  window.setTimeout(() => checkForUpdates({ manual: false }), 5000);
  window.setInterval(() => checkForUpdates({ manual: false }), 4 * 60 * 60 * 1000);
});
