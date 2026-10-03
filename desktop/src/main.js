import './styles.css';
import sampleImportJson from '../../web/sample-import.json?raw';
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
const MEMBERS_COLLECTION = 'member_research_dictionary';
const LOGIN_SESSION_COLLECTION = 'desktop_login_sessions';
const ADMIN_UID = 'KMKNZedIqZZ4kx4l3dDCSqMxYCZ2';
const CACHE_KEY = 'research_dictionary_desktop_cache_v1';
const SHORTCUT_KEY = 'research_dictionary_desktop_shortcuts_v1';
const THEME_KEY = 'research_dictionary_desktop_theme_v1';
const UPDATE_CHECK_KEY = 'research_dictionary_desktop_update_check_v1';
const LAST_UPDATE_CHECK_KEY = 'research_dictionary_desktop_last_update_check_v1';
const FONT_SCALE_KEY = 'research_dictionary_desktop_font_scale_v1';
const DISPLAY_LIMIT_KEY = 'research_dictionary_desktop_display_limit_v1';
const DISPLAY_LIMIT_OPTIONS = Object.freeze([36, 72, 144, 300, 0]);
const AUTH_SESSION_KEY = 'research_dictionary_desktop_auth_rest_v1';
const AUTH_SIGNIN_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=' + firebaseConfig.apiKey;
const AUTH_REFRESH_URL = 'https://securetoken.googleapis.com/v1/token?key=' + firebaseConfig.apiKey;
const FIRESTORE_REST_BASE = 'https://firestore.googleapis.com/v1/projects/' + firebaseConfig.projectId + '/databases/(default)/documents';
const FIRESTORE_DOC_PREFIX = 'projects/' + firebaseConfig.projectId + '/databases/(default)/documents/';
const DEFAULT_SHORTCUTS = Object.freeze({
  lookup: 'Ctrl+Shift+D',
  search: 'Ctrl+Alt+D'
});

const appWindow = getCurrentWindow();

let publicTerms = [];
let privateTerms = [];
let memberTerms = [];
let terms = [];
let currentUser = null;
let authSession = null;
let searchText = '';
let selectedTerm = null;
let loading = true;
let sourceState = 'loading';
let categoryFilter = '';
let statusFilter = '';
let scopeFilter = 'all';
let filtersOpen = false;
let editorOpen = false;
let editingTerm = null;
let importOpen = false;
let importRows = [];
let importVisibility = '';
let importBusy = false;
let loginPending = false;
let loginSessionId = '';
let loginPollTimer = null;
let loginMessage = '';
let loginError = '';
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
let displayLimit = loadDisplayLimit();

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
  if (scopeFilter === 'shared') return term.visibility !== 'private';
  if (scopeFilter === 'mine') return !!currentUser && term.createdBy === currentUser.uid;
  if (scopeFilter === 'private') return !!currentUser && term.createdBy === currentUser.uid && term.visibility === 'private';
  return true;
}

function getAllResults() {
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
    .map((x) => x.term);
}

function getResults() {
  const allResults = getAllResults();
  return displayLimit === 0 ? allResults : allResults.slice(0, displayLimit);
}

function categories() {
  return [...new Set(terms.map((t) => String(t.category || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

// visibility: private = owner only, members = signed-in users, public = everyone.
// is_shared is still written (== public) for older desktop versions.
function privateVisibility(term) {
  return ['private', 'members', 'public'].includes(term?.visibility) ? term.visibility : (term?.is_shared === true ? 'public' : 'private');
}

function mergeTerms() {
  const merged = new Map();
  publicTerms.forEach((term) => merged.set(term.id, { ...term, visibility: 'public', is_shared: true, _origin: 'public' }));
  memberTerms.forEach((term) => merged.set(term.id, { ...term, visibility: 'members', is_shared: false, _origin: 'members' }));
  privateTerms.forEach((term) => {
    const copy = merged.get(term.id);
    const visibility = privateVisibility(term);
    merged.set(term.id, { ...(copy || {}), ...term, visibility, is_shared: visibility === 'public', _origin: 'private' });
  });
  terms = [...merged.values()];
  localStorage.setItem(CACHE_KEY, JSON.stringify(terms));
}

function canEdit(term) {
  if (!currentUser || !term) return false;
  return term.createdBy === currentUser.uid || (currentUser.uid === ADMIN_UID && ['public', 'members'].includes(term._origin));
}

const VISIBILITY_OPTIONS = [['private', '私人（只有我）'], ['members', '登入可見（登入的使用者）'], ['public', '共享（所有人，含未登入）']];

function visibilityInfo(term) {
  const visibility = term?.visibility || (term?.is_shared === false ? 'private' : 'public');
  return visibility === 'private' ? ['private', '私人'] : visibility === 'members' ? ['members', '登入可見'] : ['shared', '共享'];
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

function loadSavedAuthSession() {
  try {
    const raw = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
    if (!raw?.uid || !raw?.refreshToken) return null;
    return raw;
  } catch {
    return null;
  }
}

function persistAuthSession(session) {
  authSession = session;
  if (session) {
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    currentUser = {
      uid: session.uid,
      displayName: session.displayName || '',
      email: session.email || ''
    };
  } else {
    localStorage.removeItem(AUTH_SESSION_KEY);
    currentUser = null;
  }
}

async function exchangeGoogleCredentialForFirebase(data) {
  const attempts = [];
  if (data.googleIdToken) attempts.push('id_token=' + encodeURIComponent(data.googleIdToken) + '&providerId=google.com');
  if (data.googleAccessToken) attempts.push('access_token=' + encodeURIComponent(data.googleAccessToken) + '&providerId=google.com');
  if (!attempts.length) throw new Error('網站沒有回傳 Google OAuth 憑證');

  let lastError = '';
  for (const postBody of attempts) {
    const response = await fetch(AUTH_SIGNIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody,
        requestUri: 'https://research-dictionary.vercel.app/',
        returnIdpCredential: true,
        returnSecureToken: true
      })
    });

    const json = await response.json().catch(() => ({}));
    if (response.ok && json.idToken && json.refreshToken && json.localId) {
      const session = {
        uid: json.localId,
        displayName: json.displayName || data.displayName || '',
        email: json.email || data.email || '',
        idToken: json.idToken,
        refreshToken: json.refreshToken,
        expiresAtMs: Date.now() + (Number(json.expiresIn || 3600) * 1000) - 60000
      };
      persistAuthSession(session);
      return session;
    }

    lastError = json?.error?.message || ('HTTP ' + response.status);
  }

  throw new Error('Firebase OAuth 交換失敗：' + (lastError || '未知錯誤'));
}

async function ensureFirebaseIdToken(force = false) {
  if (!authSession) throw new Error('尚未登入');
  if (!force && authSession.idToken && authSession.expiresAtMs > Date.now() + 60000) {
    return authSession.idToken;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: authSession.refreshToken
  });

  const response = await fetch(AUTH_REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.id_token) {
    persistAuthSession(null);
    throw new Error('登入已失效：' + (json?.error?.message || ('HTTP ' + response.status)));
  }

  authSession = {
    ...authSession,
    idToken: json.id_token,
    refreshToken: json.refresh_token || authSession.refreshToken,
    expiresAtMs: Date.now() + (Number(json.expires_in || 3600) * 1000) - 60000
  };
  persistAuthSession(authSession);
  return authSession.idToken;
}

async function restoreDesktopSession() {
  const saved = loadSavedAuthSession();
  if (!saved) return;
  authSession = saved;
  currentUser = {
    uid: saved.uid,
    displayName: saved.displayName || '',
    email: saved.email || ''
  };
  try {
    await ensureFirebaseIdToken();
  } catch (error) {
    console.warn('Stored desktop auth session expired:', error);
    persistAuthSession(null);
  }
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value && typeof value.toDate === 'function') return { timestampValue: value.toDate().toISOString() };
  if (value && typeof value.seconds === 'number') return { timestampValue: new Date(value.seconds * 1000).toISOString() };
  if (typeof value === 'string') {
    const isIsoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
    return isIsoTime ? { timestampValue: value } : { stringValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  return { stringValue: String(value) };
}

function firestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (['id', '_origin'].includes(key) || value === undefined) continue;
    fields[key] = firestoreValue(value);
  }
  return fields;
}

function fromFirestoreValue(value) {
  if (!value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return fromFirestoreFields(value.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)]));
}

function encodeFirestorePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

async function firestoreRestFetch(path, options = {}, retry = true) {
  const token = await ensureFirebaseIdToken();
  const response = await fetch(FIRESTORE_REST_BASE + '/' + encodeFirestorePath(path) + (options.query || ''), {
    method: options.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (response.status === 401 && retry) {
    await ensureFirebaseIdToken(true);
    return firestoreRestFetch(path, options, false);
  }

  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(json?.error?.message || ('Firestore HTTP ' + response.status));
  }

  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

// Lists every document in a collection, following nextPageToken. Errors throw instead of
// returning an empty list. Public reads need no token; private reads pass the user's ID token.
async function restListDocuments(path, token = '') {
  const documents = [];
  let pageToken = '';
  do {
    const url = FIRESTORE_REST_BASE + '/' + encodeFirestorePath(path) + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const response = await fetch(url, token ? { headers: { Authorization: 'Bearer ' + token } } : undefined);
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json?.error?.message || ('Firestore HTTP ' + response.status));
    (json.documents || []).forEach((entry) => documents.push({
      id: entry.name.split('/').pop(),
      ...fromFirestoreFields(entry.fields || {})
    }));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return documents;
}

async function listPrivateTerms(uid) {
  const terms = await restListDocuments(PRIVATE_ROOT + '/' + uid + '/terms', await ensureFirebaseIdToken());
  return terms.map((term) => ({ ...term, _origin: 'private' }));
}

async function restSetDocument(path, data) {
  return firestoreRestFetch(path, {
    method: 'PATCH',
    body: { fields: firestoreFields(data) }
  });
}

async function restDeleteDocument(path) {
  return firestoreRestFetch(path, { method: 'DELETE' });
}

// Atomic multi-document write (max 500 writes per call); security rules apply to each write.
async function restCommit(writes) {
  const token = await ensureFirebaseIdToken();
  const response = await fetch(FIRESTORE_REST_BASE + ':commit', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes })
  });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(json?.error?.message || ('Firestore HTTP ' + response.status));
  }
}

// Same field mapping as the web batch import (web/app.js normalizeImportTerm).
function normalizeImportTerm(raw = {}) {
  const statusRaw = String(raw.status || 'pending').trim().toLowerCase();
  const status = ['verified', 'confirmed', 'pending', 'candidate', 'general'].includes(statusRaw) ? statusRaw : 'pending';
  const text = (...values) => String(values.find((v) => v !== undefined && v !== null) ?? '').trim();
  return {
    term_en: text(raw.term_en, raw.termEn, raw.english),
    term_zh: text(raw.term_zh, raw.termZh, raw.chinese),
    category: text(raw.category) || '未分類',
    definition: text(raw.definition),
    simple_explanation: text(raw.simple_explanation, raw.simpleExplanation),
    example: text(raw.example),
    research_note: text(raw.research_note, raw.researchNote),
    source: text(raw.source),
    sourceType: text(raw.sourceType, raw.source_type),
    sourceDetail: text(raw.sourceDetail, raw.source_detail),
    status,
    is_core: toBool(raw.is_core ?? raw.isCore),
    visibility: importTermVisibility(raw)
  };
}

// "visibility" wins; otherwise legacy is_shared:true means public. Default private.
function importTermVisibility(raw) {
  const value = String(raw.visibility ?? '').trim().toLowerCase();
  if (['private', 'members', 'public'].includes(value)) return value;
  return toBool(raw.is_shared ?? raw.isShared) ? 'public' : 'private';
}

// Boolean('false') is true, so accept only explicit true values from JSON.
function toBool(value) {
  return value === true || value === 1 || ['true', '1', 'yes'].includes(String(value).trim().toLowerCase());
}

async function readImportFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    showToast('JSON 格式錯誤：' + (error?.message || error), true);
    return;
  }
  if (!Array.isArray(parsed)) parsed = [parsed];

  // ponytail: exact en/zh name match only; the web importer also flags "similar" names.
  const seen = new Set(terms.flatMap((t) => [normalize(t.term_en), normalize(t.term_zh)]).filter(Boolean));
  const required = [['term_en', '英文名稱'], ['term_zh', '中文名稱'], ['definition', '正式定義'], ['simple_explanation', '白話解釋']];
  importRows = parsed.map((raw) => {
    const term = normalizeImportTerm(raw && typeof raw === 'object' ? raw : {});
    const missing = required.filter(([key]) => !term[key]).map(([, label]) => label);
    if (missing.length) return { kind: 'invalid', term, note: '缺少：' + missing.join('、') };
    const keys = [normalize(term.term_en), normalize(term.term_zh)];
    if (keys.some((key) => seen.has(key))) return { kind: 'skip', term, note: '已有相同英文或中文名稱，略過' };
    keys.forEach((key) => seen.add(key));
    return { kind: 'new', term, note: term.category + ' · ' + statusInfo(term.status)[1] };
  });
  render();
}

async function runImport() {
  const rows = importRows.filter((row) => row.kind === 'new');
  if (!currentUser || !rows.length || importBusy) return;
  importBusy = true;
  render();

  const uid = currentUser.uid;
  const now = new Date().toISOString();
  let done = 0;
  try {
    // Same layout as single add: private copy always, public copy with the same id when shared.
    // 200 terms x up to 2 writes stays under the 500-write commit limit.
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const writes = [];
      chunk.forEach(({ term }) => {
        const id = crypto.randomUUID().replace(/-/g, '');
        const visibility = importVisibility || term.visibility;
        const data = {
          ...term,
          visibility,
          is_shared: visibility === 'public',
          createdBy: uid,
          createdByName: currentUser.displayName || '',
          createdByEmail: currentUser.email || '',
          createdAt: now,
          updatedAt: now
        };
        const fields = firestoreFields(data);
        writes.push({ update: { name: FIRESTORE_DOC_PREFIX + PRIVATE_ROOT + '/' + uid + '/terms/' + id, fields } });
        if (visibility === 'public') writes.push({ update: { name: FIRESTORE_DOC_PREFIX + COLLECTION_NAME + '/' + id, fields } });
        if (visibility === 'members') writes.push({ update: { name: FIRESTORE_DOC_PREFIX + MEMBERS_COLLECTION + '/' + id, fields } });
      });
      await restCommit(writes);
      done += chunk.length;
    }
    importBusy = false;
    importOpen = false;
    importRows = [];
    showToast('已匯入 ' + done + ' 個詞彙');
    await loadTerms(true);
  } catch (error) {
    console.error('Import failed:', error);
    importBusy = false;
    render();
    showToast('匯入失敗（已完成 ' + done + ' 個）：' + (error?.message || error), true);
  }
}

function downloadImportTemplate() {
  const url = URL.createObjectURL(new Blob([sampleImportJson], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'research-dictionary-sample-import.json' });
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast('範例 JSON 已下載到「下載」資料夾');
}

function importTemplate() {
  const counts = { new: 0, skip: 0, invalid: 0 };
  importRows.forEach((row) => { counts[row.kind] += 1; });
  const label = { new: '可新增', skip: '略過', invalid: '格式錯誤' };
  return `
    <div class="modal-backdrop editor-enter" id="importBackdrop">
      <section class="editor-panel panel-enter" role="dialog" aria-modal="true" aria-labelledby="importTitle">
        <div class="settings-head">
          <div><span class="settings-eyebrow">IMPORT JSON</span><h2 id="importTitle">匯入研究詞彙</h2></div>
          <button class="icon-button" id="importCloseBtn" aria-label="關閉">×</button>
        </div>
        <p class="settings-note">選擇 .json 檔，內容為詞彙陣列。必填 <code>term_en</code>、<code>term_zh</code>、<code>definition</code>、<code>simple_explanation</code>；選填 <code>category</code>、<code>status</code>（verified／pending／candidate）、<code>example</code>、<code>research_note</code>、<code>source</code>、<code>sourceType</code>、<code>sourceDetail</code>（沒有頁碼請留空）、<code>is_core</code>、<code>visibility</code>（private／members／public，預設 private）。</p>
        <div class="import-pick">
          <input id="importFile" type="file" accept="application/json,.json" ${importBusy ? 'disabled' : ''}>
          <button class="small-btn" id="importTemplateBtn">下載範例 JSON</button>
        </div>
        <label class="import-visibility">可見範圍
          <select id="importVisibility" ${importBusy ? 'disabled' : ''}>
            <option value="" ${importVisibility === '' ? 'selected' : ''}>依檔案內的 visibility（未填為私人）</option>
            ${VISIBILITY_OPTIONS.map(([value, label]) => `<option value="${value}" ${importVisibility === value ? 'selected' : ''}>全部${label}</option>`).join('')}
          </select>
        </label>
        ${importRows.length ? `
          <div class="import-summary">共 ${importRows.length} 筆：可新增 ${counts.new}、略過 ${counts.skip}、格式錯誤 ${counts.invalid}</div>
          <div class="import-list">${importRows.map((row) => `
            <div class="import-row ${row.kind}">
              <div><strong>${escapeHtml(row.term.term_en || '（未填英文）')}｜${escapeHtml(row.term.term_zh || '（未填中文）')}</strong><small>${escapeHtml(row.note)}${row.kind === 'new' ? ' · ' + visibilityInfo({ visibility: importVisibility || row.term.visibility })[1] : ''}</small></div>
              <span>${label[row.kind]}</span>
            </div>`).join('')}
          </div>` : ''}
        <div class="modal-actions">
          <button type="button" class="secondary-btn" id="importCancelBtn" ${importBusy ? 'disabled' : ''}>取消</button>
          <button type="button" class="primary-btn compact" id="importRunBtn" ${counts.new && !importBusy ? '' : 'disabled'}>${importBusy ? '匯入中…' : '匯入 ' + counts.new + ' 個詞彙'}</button>
        </div>
      </section>
    </div>`;
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

function loadDisplayLimit() {
  const saved = Number(localStorage.getItem(DISPLAY_LIMIT_KEY));
  return DISPLAY_LIMIT_OPTIONS.includes(saved) ? saved : 72;
}

function applyDisplayLimit(value, persist = true) {
  const parsed = Number(value);
  displayLimit = DISPLAY_LIMIT_OPTIONS.includes(parsed) ? parsed : 72;
  if (persist) localStorage.setItem(DISPLAY_LIMIT_KEY, String(displayLimit));
  return displayLimit;
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
  loginError = '';
  loginMessage = '已開啟瀏覽器，等待 Google 登入授權…';
  loginSessionId = makeSessionId();
  render();

  try {
    await invoke('open_desktop_login_url', { sessionId: loginSessionId });
  } catch (error) {
    loginPending = false;
    loginMessage = '';
    loginError = String(error?.message || error);
    showToast('無法開啟登入頁面：' + loginError, true);
    render();
    return;
  }

  let attempts = 0;
  let lastPollError = '';
  const poll = async () => {
    if (!loginPending || !loginSessionId) return;
    attempts += 1;

    try {
      const response = await fetch(FIRESTORE_REST_BASE + '/' + LOGIN_SESSION_COLLECTION + '/' + encodeURIComponent(loginSessionId));
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(json?.error?.message || ('Firestore HTTP ' + response.status)), { code: json?.error?.status });

      const data = fromFirestoreFields(json.fields || {});
      const expiresAtMs = Date.parse(data.expiresAt) || data.expiresAtMs || 0;
      if (expiresAtMs && Date.now() > expiresAtMs) {
        throw new Error('登入授權已逾時，請重新登入');
      }

      const session = await exchangeGoogleCredentialForFirebase(data);

      try {
        await restDeleteDocument(LOGIN_SESSION_COLLECTION + '/' + loginSessionId);
      } catch (cleanupError) {
        console.warn('Desktop login session cleanup failed:', cleanupError);
      }

      loginPending = false;
      loginMessage = '';
      loginError = '';
      loginSessionId = '';
      showToast('已登入 ' + (session.displayName || session.email || 'Google 帳號'));
      await loadTerms(true);
      render();
      return;
    } catch (error) {
      const text = String(error?.message || error);
      // Rules only allow get on an existing, unexpired session, so a missing
      // document (web login not finished yet) also returns permission-denied.
      // Keep polling; only surface it if we time out.
      if (/逾時|OAuth 交換失敗|憑證/.test(text)) {
        loginPending = false;
        loginMessage = '';
        loginError = text;
        showToast('桌面登入失敗：' + text, true);
        render();
        return;
      }
      lastPollError = (error?.code ? error.code + '：' : '') + text;
      if (!/permission|insufficient/i.test(text)) console.warn('Desktop login polling:', error);
    }

    if (attempts >= 120) {
      loginPending = false;
      loginMessage = '';
      loginError = '登入等待逾時，請重新操作。' + (lastPollError ? '（最後回應：' + lastPollError + '）' : '');
      loginSessionId = '';
      showToast(loginError, true);
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
  loginError = '';
  loginSessionId = '';
  if (loginPollTimer) window.clearTimeout(loginPollTimer);
  loginPollTimer = null;
  render();
}

async function logoutDesktop() {
  cancelDesktopLogin();
  persistAuthSession(null);
  privateTerms = [];
  memberTerms = [];
  selectedTerm = null;
  scopeFilter = 'all';
  mergeTerms();
  render();
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
    updateInfo = Array.isArray(info) && info.length >= 2
      ? { version: info[0], downloadUrl: info[1], digest: info[2] || '' }
      : null;
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
      <select id="displayLimitFilter" aria-label="顯示筆數">
        <option value="36" ${displayLimit === 36 ? 'selected' : ''}>顯示 36 筆</option>
        <option value="72" ${displayLimit === 72 ? 'selected' : ''}>顯示 72 筆</option>
        <option value="144" ${displayLimit === 144 ? 'selected' : ''}>顯示 144 筆</option>
        <option value="300" ${displayLimit === 300 ? 'selected' : ''}>顯示 300 筆</option>
        <option value="0" ${displayLimit === 0 ? 'selected' : ''}>顯示全部</option>
      </select>
    </div>`;
}

function renderAccountBar() {
  if (currentUser) {
    const name = currentUser.displayName || currentUser.email || '已登入';
    const initial = (name.trim()[0] || 'U').toUpperCase();
    return `
      <div class="account-inline signed-in">
        <span class="avatar">${escapeHtml(initial)}</span>
        <span class="account-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        <button class="toolbar-btn accent" id="addTermBtn">＋ 新增</button>
        <button class="toolbar-btn" id="importBtn">匯入</button>
        <button class="toolbar-btn" id="logoutBtn">登出</button>
      </div>`;
  }

  return `
    <div class="account-inline">
      ${loginError ? `<button class="login-error" id="loginErrorBtn" title="${escapeHtml(loginError)}">登入失敗：${escapeHtml(loginError)}</button>` : ''}
      ${loginPending
        ? '<button class="toolbar-btn" id="cancelLoginBtn">等待登入… ×</button>'
        : '<button class="toolbar-btn accent" id="loginBtn">Google 登入</button>'}
    </div>`;
}

function updateFooterTemplate() {
  if (updateInstalling) return '<button class="update-btn" disabled>正在更新…</button>';
  if (updateInfo) return `<button class="update-btn" id="installUpdateBtn">更新至 v${escapeHtml(updateInfo.version)}</button>`;
  if (updateChecking) return '<button class="text-btn" disabled>檢查更新中…</button>';
  return `<button class="text-btn" id="checkUpdateBtn">檢查更新${appVersion !== '0.0.0' ? ` · v${escapeHtml(appVersion)}` : ''}</button>`;
}

function render() {
  const allResults = getAllResults();
  const results = displayLimit === 0 ? allResults : allResults.slice(0, displayLimit);
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

      <section class="search-section compact-search">
        <div class="search-box">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>
          <input id="searchInput" autocomplete="off" spellcheck="false" placeholder="搜尋詞彙、定義、分類、來源…" value="${escapeHtml(searchText)}" />
          ${searchText ? '<button id="clearBtn" class="clear-btn" aria-label="清除搜尋">×</button>' : `<kbd>${escapeHtml(shortcutLabel(shortcutConfig.search))}</kbd>`}
        </div>
        <div class="compact-toolbar">
          <div class="lookup-hint"><b>${escapeHtml(shortcutLabel(shortcutConfig.lookup))}</b><span>反白查詢</span></div>
          <div class="compact-toolbar-actions">
            <span class="shortcut-state dot-only ${hotkeyClass}" title="${escapeHtml(hotkeyError || hotkeyLabel)}"><i></i></span>
            <span class="sync dot-only ${sourceState}" title="${escapeHtml(sourceLabel)}"><i></i></span>
            <button class="toolbar-btn ${filtersOpen ? 'active' : ''}" id="filterToggleBtn">篩選${(categoryFilter || statusFilter || scopeFilter !== 'all') ? ' •' : ''}</button>
            ${renderAccountBar()}
          </div>
        </div>
        ${filtersOpen ? renderFilters() : ''}
      </section>

      ${current ? detailTemplate(current) : listTemplate(results, allResults.length)}

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
      ${importOpen ? importTemplate() : ''}
      <div id="toast" class="toast" aria-live="polite"></div>
    </main>
  `;

  wireEvents();
}

function listTemplate(results, totalResults = results.length) {
  if (loading) {
    return `<section class="content"><div class="empty"><div class="spinner"></div><strong>正在讀取研究辭典</strong><span>同步共享詞彙與你的私人詞彙。</span></div></section>`;
  }
  if (!results.length) {
    return `<section class="content"><div class="empty"><div class="empty-icon">?</div><strong>找不到符合條件的詞彙</strong><span>${searchText ? `沒有找到「${escapeHtml(searchText)}」` : '請調整分類、狀態或顯示範圍。'}</span>${currentUser ? '<button class="primary-btn" id="emptyAddBtn">＋ 新增詞彙</button>' : ''}</div></section>`;
  }

  return `
    <section class="content">
      <div class="result-head"><strong>顯示 ${results.length} / ${totalResults} 個詞彙</strong><span>${searchText ? '搜尋結果 · ' : ''}${terms.length} 個可用詞彙</span></div>
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
  const visibility = editingTerm ? term.visibility || 'private' : 'private';
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
            <label>可見範圍
              <select name="visibility">${VISIBILITY_OPTIONS.map(([value, label]) => `<option value="${value}" ${visibility === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
            </label>
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

  document.querySelector('#filterToggleBtn')?.addEventListener('click', () => {
    filtersOpen = !filtersOpen;
    render();
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
  document.querySelector('#displayLimitFilter')?.addEventListener('change', (event) => {
    applyDisplayLimit(event.target.value);
    selectedTerm = null;
    render();
  });

  document.querySelector('#loginBtn')?.addEventListener('click', startDesktopLogin);
  document.querySelector('#loginErrorBtn')?.addEventListener('click', () => showToast(loginError || '登入失敗', true));
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

  document.querySelector('#importBtn')?.addEventListener('click', () => {
    importOpen = true;
    importRows = [];
    render();
  });
  const closeImport = () => {
    if (importBusy) return;
    importOpen = false;
    importRows = [];
    render();
  };
  document.querySelector('#importCloseBtn')?.addEventListener('click', closeImport);
  document.querySelector('#importCancelBtn')?.addEventListener('click', closeImport);
  document.querySelector('#importBackdrop')?.addEventListener('mousedown', (event) => {
    if (event.target.id === 'importBackdrop') closeImport();
  });
  document.querySelector('#importFile')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) readImportFile(file);
  });
  document.querySelector('#importVisibility')?.addEventListener('change', (event) => {
    importVisibility = event.target.value;
    render();
  });
  document.querySelector('#importTemplateBtn')?.addEventListener('click', downloadImportTemplate);
  document.querySelector('#importRunBtn')?.addEventListener('click', runImport);

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
    visibility: ['members', 'public'].includes(data.get('visibility')) ? data.get('visibility') : 'private'
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
    const isAdminEditingOther = original && original.createdBy !== uid && uid === ADMIN_UID && ['public', 'members'].includes(original._origin);
    const now = new Date().toISOString();

    if (isAdminEditingOther) {
      // Admin edits another user's copy in place and keeps its visibility.
      const inMembers = original._origin === 'members';
      const fullPayload = {
        ...original,
        ...payload,
        visibility: inMembers ? 'members' : 'public',
        is_shared: !inMembers,
        updatedAt: now
      };
      await restSetDocument((inMembers ? MEMBERS_COLLECTION : COLLECTION_NAME) + '/' + original.id, fullPayload);
    } else {
      if (original && original.createdBy && original.createdBy !== uid) {
        throw new Error('你只能修改自己建立的詞彙');
      }

      const termId = original?.id || crypto.randomUUID().replace(/-/g, '');
      const fullPayload = {
        ...payload,
        is_shared: payload.visibility === 'public',
        createdBy: uid,
        createdByName: currentUser.displayName || '',
        createdByEmail: currentUser.email || '',
        createdAt: original?.createdAt || now,
        updatedAt: now
      };

      // Private copy always; the public or members copy (same id) follows the chosen visibility.
      await restSetDocument(PRIVATE_ROOT + '/' + uid + '/terms/' + termId, fullPayload);
      for (const [level, path, copies] of [['public', COLLECTION_NAME, publicTerms], ['members', MEMBERS_COLLECTION, memberTerms]]) {
        if (payload.visibility === level) await restSetDocument(path + '/' + termId, fullPayload);
        else if (copies.some((term) => term.id === termId && term.createdBy === uid)) await restDeleteDocument(path + '/' + termId);
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
    if (term.createdBy !== uid && uid === ADMIN_UID && ['public', 'members'].includes(term._origin)) {
      await restDeleteDocument((term._origin === 'members' ? MEMBERS_COLLECTION : COLLECTION_NAME) + '/' + term.id);
    } else {
      try { await restDeleteDocument(PRIVATE_ROOT + '/' + uid + '/terms/' + term.id); } catch {}
      if (publicTerms.some((item) => item.id === term.id && item.createdBy === uid)) await restDeleteDocument(COLLECTION_NAME + '/' + term.id);
      if (memberTerms.some((item) => item.id === term.id && item.createdBy === uid)) await restDeleteDocument(MEMBERS_COLLECTION + '/' + term.id);
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
    // REST, not the Firebase SDK: in the Tauri WebView the SDK could resolve an
    // empty snapshot when its connection failed, hiding every public term.
    publicTerms = (await restListDocuments(COLLECTION_NAME)).map((term) => ({
      ...term,
      is_shared: true,
      _origin: 'public'
    }));

    if (currentUser) {
      try {
        privateTerms = await listPrivateTerms(currentUser.uid);
      } catch (privateError) {
        console.warn('Private dictionary unavailable:', privateError);
        privateTerms = [];
        showToast('私人辭典同步失敗：' + (privateError?.message || privateError), true);
      }
      try {
        memberTerms = await restListDocuments(MEMBERS_COLLECTION, await ensureFirebaseIdToken());
      } catch (memberError) {
        console.warn('Members dictionary unavailable:', memberError);
        memberTerms = [];
        showToast('登入可見辭典同步失敗：' + (memberError?.message || memberError), true);
      }
    } else {
      privateTerms = [];
      memberTerms = [];
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
    if (importOpen) {
      if (!importBusy) { importOpen = false; importRows = []; render(); }
    } else if (editorOpen) {
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

window.addEventListener('DOMContentLoaded', async () => {
  try { appVersion = await getVersion(); } catch {}
  await restoreDesktopSession();
  render();
  await loadTerms();
  try {
    await registerHotkeys(shortcutConfig);
  } catch (error) {
    console.error('Global shortcut registration failed:', error);
  }
  render();

  window.setTimeout(() => checkForUpdates({ manual: false }), 5000);
  window.setInterval(() => checkForUpdates({ manual: false }), 4 * 60 * 60 * 1000);
});
