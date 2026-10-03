import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import { getFirestore, collection, addDoc, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, serverTimestamp, Timestamp, getDocs, writeBatch } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAdFJeGDJI9IxRZ9_k2ssOP9Ns3DL6Nhlg',
  authDomain: 'deer-7327a.firebaseapp.com',
  projectId: 'deer-7327a',
  storageBucket: 'deer-7327a.firebasestorage.app',
  messagingSenderId: '772101073013',
  appId: '1:772101073013:web:098e979cb896d2f633b03c',
  measurementId: 'G-CE68YLW648'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const termsRef = collection(db, 'research_dictionary');
const MEMBERS_COLLECTION = 'member_research_dictionary';
const membersRef = collection(db, MEMBERS_COLLECTION);
const provider = new GoogleAuthProvider();
const ADMIN_UID = 'KMKNZedIqZZ4kx4l3dDCSqMxYCZ2';

let currentUser = null;
let terms = [];
let publicTerms = [];
let privateTerms = [];
let memberTerms = [];
let unsubscribePrivateTerms = null;
let unsubscribeMemberTerms = null;
let pendingImportRows = [];
const desktopSessionId = (() => {
  const value = new URLSearchParams(location.search).get('desktop_login') || '';
  return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : '';
})();
const THEME_KEY = 'research_dictionary_theme_v1';
const FONT_SCALE_KEY = 'research_dictionary_font_scale_v1';
let currentTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

const $ = (id) => document.getElementById(id);
const els = {
  loginBtn:$('loginBtn'), logoutBtn:$('logoutBtn'), addBtn:$('addBtn'), importBtn:$('importBtn'), searchInput:$('searchInput'), clearSearchBtn:$('clearSearchBtn'),
  categoryFilter:$('categoryFilter'), statusFilter:$('statusFilter'), coreOnly:$('coreOnly'), mineOnly:$('mineOnly'), mineWrap:$('mineWrap'),
  filterToggle:$('filterToggle'), filterPanel:$('filterPanel'), activeFilterCount:$('activeFilterCount'), clearFiltersBtn:$('clearFiltersBtn'),
  resultCount:$('resultCount'), resultContext:$('resultContext'), noResultsText:$('noResultsText'),
  termsGrid:$('termsGrid'), noResults:$('noResults'), emptySetup:$('emptySetup'), seedBtn:$('seedBtn'),
  termDialog:$('termDialog'), termForm:$('termForm'), closeDialog:$('closeDialog'), cancelDialog:$('cancelDialog'),
  termId:$('termId'), termEn:$('termEn'), termZh:$('termZh'), category:$('category'), status:$('status'), definition:$('definition'), simpleExplanation:$('simpleExplanation'), example:$('example'), researchNote:$('researchNote'), source:$('source'), sourceType:$('sourceType'), sourceDetail:$('sourceDetail'), isCore:$('isCore'), visibility:$('visibility'), duplicateHint:$('duplicateHint'), saveTermBtn:$('saveTermBtn'),
  detailDialog:$('detailDialog'), detailContent:$('detailContent'), toast:$('toast'), categoryList:$('categoryList'),
  themeToggle:$('themeToggle'), fontSizeSlider:$('fontSizeSlider'), fontSizeValue:$('fontSizeValue'),
  importDialog:$('importDialog'), closeImportDialog:$('closeImportDialog'), cancelImportDialog:$('cancelImportDialog'), batchJson:$('batchJson'), batchFile:$('batchFile'), importVisibility:$('importVisibility'), analyzeImportBtn:$('analyzeImportBtn'), importSummary:$('importSummary'), importPreview:$('importPreview'), executeImportBtn:$('executeImportBtn'),
  desktopAuthBanner:$('desktopAuthBanner'), desktopAuthTitle:$('desktopAuthTitle'), desktopAuthText:$('desktopAuthText'), desktopAuthorizeBtn:$('desktopAuthorizeBtn')
};


function updateThemeButton(){
  if(!els.themeToggle) return;
  const text=els.themeToggle.querySelector('.theme-toggle-text');
  els.themeToggle.dataset.theme=currentTheme;
  els.themeToggle.setAttribute('aria-label', currentTheme==='dark'?'切換為淺色模式':'切換為深色模式');
  els.themeToggle.title=currentTheme==='dark'?'切換為淺色模式':'切換為深色模式';
  if(text) text.textContent=currentTheme==='dark'?'深色':'淺色';
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content',currentTheme==='dark'?'#0b1020':'#f4f7fb');
}

function setTheme(theme,{persist=true}={}){
  currentTheme=theme==='light'?'light':'dark';
  document.documentElement.classList.add('theme-transitioning');
  document.documentElement.dataset.theme=currentTheme;
  document.documentElement.style.colorScheme=currentTheme;
  if(persist) localStorage.setItem(THEME_KEY,currentTheme);
  updateThemeButton();
  window.setTimeout(()=>document.documentElement.classList.remove('theme-transitioning'),360);
}

function toggleTheme(){ setTheme(currentTheme==='dark'?'light':'dark'); }

function clampFontScale(value){
  const n=Number(value);
  if(!Number.isFinite(n)) return 100;
  return Math.min(150,Math.max(90,Math.round(n/5)*5));
}
function applyFontScale(value,{persist=true}={}){
  const next=clampFontScale(value);
  document.documentElement.style.setProperty('--font-scale',String(next/100));
  if(els.fontSizeSlider) els.fontSizeSlider.value=String(next);
  if(els.fontSizeValue) els.fontSizeValue.textContent=`${next}%`;
  if(persist) localStorage.setItem(FONT_SCALE_KEY,String(next));
  return next;
}
function initFontScale(){
  const saved=clampFontScale(localStorage.getItem(FONT_SCALE_KEY) || 100);
  applyFontScale(saved,{persist:false});
}

function escapeHtml(v=''){ return String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function showToast(message, error=false){ els.toast.textContent=message; els.toast.className='toast show'+(error?' error':''); setTimeout(()=>els.toast.className='toast',3000); }
function statusLabel(status){
  return status==='verified'?'已驗證'
    :status==='pending'?'待確認'
    :status==='candidate'?'候選定義'
    :status==='confirmed'?'已確認（舊）'
    :status==='general'?'一般詞彙（舊）'
    :(status||'未設定');
}
function ownerName(t){ return t.createdByName || t.createdByEmail || '研究辭典使用者'; }
function canEdit(t){ return !!currentUser && (t.createdBy === currentUser.uid || currentUser.uid === ADMIN_UID); }

function personalTermsCollection(uid){
  return collection(db,'user_research_dictionary',uid,'terms');
}

// visibility: private = owner only, members = signed-in users, public = everyone.
// is_shared is kept (== public) for older desktop versions.
const VISIBILITY_LABEL={private:'私人',members:'登入可見',public:'共享'};
function privateVisibility(t){
  return ['private','members','public'].includes(t?.visibility) ? t.visibility : (t?.is_shared===true ? 'public' : 'private');
}

function mergeVisibleTerms(){
  const merged=new Map(publicTerms.map(t=>[t.id,{...t,visibility:'public',is_shared:true,_origin:'public'}]));
  memberTerms.forEach(t=>merged.set(t.id,{...t,visibility:'members',is_shared:false,_origin:'members'}));
  privateTerms.forEach(t=>{
    const copy=merged.get(t.id);
    const visibility=privateVisibility(t);
    merged.set(t.id,{...(copy||{}),...t,visibility,is_shared:visibility==='public',_origin:'private'});
  });
  terms=[...merged.values()];
  render();
}

function subscribePrivateTerms(user){
  if(unsubscribePrivateTerms){ unsubscribePrivateTerms(); unsubscribePrivateTerms=null; }
  if(unsubscribeMemberTerms){ unsubscribeMemberTerms(); unsubscribeMemberTerms=null; }
  privateTerms=[];
  memberTerms=[];
  if(!user){ mergeVisibleTerms(); return; }
  unsubscribeMemberTerms=onSnapshot(membersRef,snap=>{
    memberTerms=snap.docs.map(d=>({id:d.id,...d.data()}));
    mergeVisibleTerms();
  },err=>{
    console.error('Member dictionary read failed',err);
    memberTerms=[];
    mergeVisibleTerms();
  });
  unsubscribePrivateTerms=onSnapshot(personalTermsCollection(user.uid),snap=>{
    privateTerms=snap.docs.map(d=>({id:d.id,...d.data(),_origin:'private'}));
    mergeVisibleTerms();
  },err=>{
    console.error('Private dictionary read failed',err);
    privateTerms=[];
    mergeVisibleTerms();
  });
}

async function syncPersonalTerm(termId,payload,original=null){
  if(!currentUser) throw new Error('請先登入');
  const uid=currentUser.uid;
  const personalRef=doc(db,'user_research_dictionary',uid,'terms',termId);
  const publicRef=doc(db,'research_dictionary',termId);
  const membersDocRef=doc(db,MEMBERS_COLLECTION,termId);
  const isOwner=!original || original.createdBy===uid;

  if(!isOwner && uid===ADMIN_UID){
    // Admin edits another user's copy in place and keeps its visibility.
    const inMembers=original?._origin==='members';
    await updateDoc(inMembers?membersDocRef:publicRef,{...payload,visibility:inMembers?'members':'public',is_shared:!inMembers,updatedAt:serverTimestamp()});
    return;
  }
  if(!isOwner) throw new Error('你只能修改自己建立的詞條');

  const visibility=['members','public'].includes(payload.visibility)?payload.visibility:'private';
  const createdAt=original?.createdAt || serverTimestamp();
  const base={
    ...payload,
    visibility,
    is_shared:visibility==='public',
    createdBy:uid,
    createdByName:currentUser.displayName||'',
    createdByEmail:currentUser.email||'',
    createdAt,
    updatedAt:serverTimestamp()
  };
  await setDoc(personalRef,base,{merge:true});

  if(visibility==='public') await setDoc(publicRef,base,{merge:true});
  else if(publicTerms.some(t=>t.id===termId && t.createdBy===uid)) await deleteDoc(publicRef);

  if(visibility==='members') await setDoc(membersDocRef,base,{merge:true});
  else if(memberTerms.some(t=>t.id===termId && t.createdBy===uid)) await deleteDoc(membersDocRef);
}

async function deletePersonalTerm(term){
  if(!currentUser) throw new Error('請先登入');
  const uid=currentUser.uid;
  if(term.createdBy!==uid && uid!==ADMIN_UID) throw new Error('你只能刪除自己建立的詞條');

  if(term.createdBy!==uid && uid===ADMIN_UID){
    await deleteDoc(doc(db,term._origin==='members'?MEMBERS_COLLECTION:'research_dictionary',term.id));
    return;
  }

  await deleteDoc(doc(db,'user_research_dictionary',uid,'terms',term.id)).catch(()=>{});
  const shared=publicTerms.find(t=>t.id===term.id && t.createdBy===uid);
  if(shared) await deleteDoc(doc(db,'research_dictionary',term.id));
  const memberCopy=memberTerms.find(t=>t.id===term.id && t.createdBy===uid);
  if(memberCopy) await deleteDoc(doc(db,MEMBERS_COLLECTION,term.id));
}

function setupDesktopAuthBanner(){
  if(!desktopSessionId || !els.desktopAuthBanner) return;
  els.desktopAuthBanner.classList.remove('hidden');
  els.desktopAuthTitle.textContent='Research Dictionary Desktop 登入授權';
  els.desktopAuthText.textContent='請使用 Google 帳號登入，完成後桌面程式會自動接收登入狀態。';
}

async function authorizeDesktopLogin(){
  if(!desktopSessionId) return;
  els.desktopAuthorizeBtn.disabled=true;
  els.desktopAuthorizeBtn.textContent='授權中…';
  try{
    const result=await signInWithPopup(auth,provider);
    const credential=GoogleAuthProvider.credentialFromResult(result);
    if(!credential?.idToken && !credential?.accessToken) throw new Error('無法取得 Google 登入憑證');
    await setDoc(doc(db,'desktop_login_sessions',desktopSessionId),{
      uid:result.user.uid,
      displayName:result.user.displayName||'',
      email:result.user.email||'',
      googleIdToken:credential.idToken||'',
      googleAccessToken:credential.accessToken||'',
      createdAt:serverTimestamp(),
      expiresAt:Timestamp.fromMillis(Date.now()+5*60*1000),
      expiresAtMs:Date.now()+5*60*1000
    });
    els.desktopAuthTitle.textContent='桌面版登入授權完成';
    els.desktopAuthText.textContent='Research Dictionary Desktop 會自動完成登入。你可以關閉這個分頁。';
    els.desktopAuthorizeBtn.classList.add('hidden');
    showToast('桌面版登入授權完成');
  }catch(e){
    console.error(e);
    els.desktopAuthorizeBtn.disabled=false;
    els.desktopAuthorizeBtn.textContent='重新授權桌面版';
    showToast(`桌面版授權失敗：${e.code||e.message}`,true);
  }
}

function normalizeTermKey(value=''){
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_/·・.,，。:：;；()（）\[\]【】'"`]/g,'');
}

function normalizeSearchText(value=''){
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[\s\-_/·・.,，。:：;；()（）\[\]【】{}「」『』'"`]+/g, '');
}

function searchTokens(value=''){
  const raw=String(value).normalize('NFKC').toLowerCase().trim();
  if(!raw) return [];
  const split=raw
    .replace(/[‐‑‒–—―_/·・.,，。:：;；()（）\[\]【】{}「」『』'"`]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const normalizedParts=split.map(normalizeSearchText).filter(Boolean);
  if(normalizedParts.length) return [...new Set(normalizedParts)];
  const compact=normalizeSearchText(raw);
  return compact?[compact]:[];
}

function searchableFields(term){
  return [
    {value:term.term_en, weight:150},
    {value:term.term_zh, weight:145},
    {value:term.category, weight:55},
    {value:term.simple_explanation, weight:42},
    {value:term.definition, weight:36},
    {value:term.research_note, weight:24},
    {value:term.source, weight:18},
    {value:term.example, weight:14},
    {value:term.sourceType, weight:12},
    {value:term.sourceDetail, weight:10}
  ].filter(field=>field.value);
}

function scoreSearchMatch(term, queryText){
  const tokens=searchTokens(queryText);
  if(!tokens.length) return 0;
  const fields=searchableFields(term).map(field=>({ ...field, normalized:normalizeSearchText(field.value) }));
  let score=0;

  for(const token of tokens){
    let best=0;
    for(const field of fields){
      if(!field.normalized.includes(token)) continue;
      const exact=field.normalized===token;
      const starts=field.normalized.startsWith(token);
      best=Math.max(best, field.weight + (exact?90:starts?45:12));
    }
    if(best===0) return -1;
    score+=best;
  }

  const compactQuery=normalizeSearchText(queryText);
  const en=normalizeSearchText(term.term_en);
  const zh=normalizeSearchText(term.term_zh);
  if(compactQuery && (en===compactQuery || zh===compactQuery)) score+=220;
  else if(compactQuery && (en.startsWith(compactQuery) || zh.startsWith(compactQuery))) score+=100;
  else if(compactQuery && (en.includes(compactQuery) || zh.includes(compactQuery))) score+=55;

  return score;
}

function debounce(fn, wait=250){
  let timer;
  return (...args)=>{
    clearTimeout(timer);
    timer=setTimeout(()=>fn(...args), wait);
  };
}

function findDuplicate(termEn, termZh, excludeId=''){
  const enKey = normalizeTermKey(termEn);
  const zhKey = normalizeTermKey(termZh);
  if(!enKey && !zhKey) return null;
  return terms.find(t => {
    if(t.id === excludeId) return false;
    const sameEn = enKey && normalizeTermKey(t.term_en) === enKey;
    const sameZh = zhKey && normalizeTermKey(t.term_zh) === zhKey;
    return sameEn || sameZh;
  }) || null;
}

function englishTokens(value=''){
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/chain[\s-]+of[\s-]+thought/g,' cot ')
    .replace(/[^a-z0-9]+/g,' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter(w=>!['the','a','an','and','or','of','with','for','to','in','on','by','from','based'].includes(w));
}

function acronym(value=''){
  const tokens=englishTokens(value);
  return tokens.map(w=>w==='cot'?'cot':w[0]).join('');
}

function levenshtein(a='',b=''){
  a=String(a); b=String(b);
  if(!a.length) return b.length; if(!b.length) return a.length;
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let prev=row[0]; row[0]=i;
    for(let j=1;j<=b.length;j++){
      const old=row[j];
      row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));
      prev=old;
    }
  }
  return row[b.length];
}

function similarity(a='',b=''){
  const aa=normalizeTermKey(a), bb=normalizeTermKey(b);
  if(!aa || !bb) return 0;
  return 1 - levenshtein(aa,bb)/Math.max(aa.length,bb.length);
}

function findSimilar(termEn, termZh, excludeId=''){
  const enKey=normalizeTermKey(termEn), zhKey=normalizeTermKey(termZh);
  const ac=normalizeTermKey(acronym(termEn));
  return terms.find(t=>{
    if(t.id===excludeId) return false;
    const ten=normalizeTermKey(t.term_en), tzh=normalizeTermKey(t.term_zh);
    const tac=normalizeTermKey(acronym(t.term_en));
    if(enKey && ten && Math.min(enKey.length,ten.length)>=6 && similarity(enKey,ten)>=0.86) return true;
    if(zhKey && tzh && Math.min(zhKey.length,tzh.length)>=3 && similarity(zhKey,tzh)>=0.82) return true;
    if(ac && ac.length>=2 && (ac===ten || (tac && tac===enKey) || (tac && tac===ac))) return true;
    if(enKey && ten && Math.min(enKey.length,ten.length)>=5 && (enKey.includes(ten) || ten.includes(enKey))) return true;
    if(zhKey && tzh && Math.min(zhKey.length,tzh.length)>=3 && (zhKey.includes(tzh) || tzh.includes(zhKey))) return true;
    return false;
  }) || null;
}

function normalizeImportTerm(raw={}){
  const statusRaw=String(raw.status || 'pending').trim().toLowerCase();
  const status=['verified','confirmed','pending','candidate','general'].includes(statusRaw)?statusRaw:'pending';
  return {
    term_en:String(raw.term_en ?? raw.termEn ?? raw.english ?? '').trim(),
    term_zh:String(raw.term_zh ?? raw.termZh ?? raw.chinese ?? '').trim(),
    category:String(raw.category ?? '未分類').trim() || '未分類',
    definition:String(raw.definition ?? '').trim(),
    simple_explanation:String(raw.simple_explanation ?? raw.simpleExplanation ?? '').trim(),
    example:String(raw.example ?? '').trim(),
    research_note:String(raw.research_note ?? raw.researchNote ?? '').trim(),
    source:String(raw.source ?? '').trim(),
    sourceType:String(raw.sourceType ?? raw.source_type ?? '').trim(),
    sourceDetail:String(raw.sourceDetail ?? raw.source_detail ?? '').trim(),
    status,
    is_core:toBool(raw.is_core ?? raw.isCore),
    visibility:importVisibility(raw)
  };
}

// "visibility" wins; otherwise legacy is_shared:true means public. Default private.
function importVisibility(raw){
  const v=String(raw.visibility ?? '').trim().toLowerCase();
  if(['private','members','public'].includes(v)) return v;
  return toBool(raw.is_shared ?? raw.isShared) ? 'public' : 'private';
}

// Boolean('false') is true, so accept only explicit true values from JSON.
function toBool(value){
  return value===true || value===1 || ['true','1','yes'].includes(String(value).trim().toLowerCase());
}

function validateImportTerm(t){
  const missing=[];
  if(!t.term_en) missing.push('英文名稱');
  if(!t.term_zh) missing.push('中文名稱');
  if(!t.definition) missing.push('正式定義');
  if(!t.simple_explanation) missing.push('白話解釋');
  return missing;
}

function resetImportDialog(){
  pendingImportRows=[];
  els.batchJson.value='';
  els.batchFile.value='';
  if(els.importVisibility) els.importVisibility.value='';
  els.importSummary.classList.add('hidden');
  els.importPreview.classList.add('hidden');
  els.importSummary.innerHTML='';
  els.importPreview.innerHTML='';
  els.executeImportBtn.disabled=true;
  els.executeImportBtn.textContent='匯入可新增詞彙';
}

function renderImportPreview(){
  const counts=pendingImportRows.reduce((a,r)=>{a[r.kind]=(a[r.kind]||0)+1; return a;},{new:0,skip:0,review:0,invalid:0});
  const selectedReview=pendingImportRows.filter(r=>r.kind==='review' && r.force).length;
  els.importSummary.innerHTML=`
    <span class="stat"><strong>${pendingImportRows.length}</strong>總筆數</span>
    <span class="stat"><strong>${counts.new}</strong>可新增</span>
    <span class="stat"><strong>${counts.skip}</strong>已存在</span>
    <span class="stat"><strong>${counts.review}</strong>疑似重複</span>
    <span class="stat"><strong>${counts.invalid}</strong>格式問題</span>`;
  els.importSummary.classList.remove('hidden');

  els.importPreview.innerHTML=pendingImportRows.map((r,i)=>{
    const t=r.term;
    const right=r.kind==='review'
      ? `<label class="review-check"><input type="checkbox" data-force-import="${i}" ${r.force?'checked':''}>仍要匯入</label>`
      : `<span class="import-status ${r.kind}">${r.kind==='new'?'可新增':r.kind==='skip'?'跳過':r.kind==='invalid'?'格式錯誤':'需確認'}</span>`;
    const note=r.kind==='skip' && r.match ? `已存在：${escapeHtml(r.match.term_en)}｜${escapeHtml(r.match.term_zh)}`
      : r.kind==='review' && r.match ? `疑似與「${escapeHtml(r.match.term_en)}｜${escapeHtml(r.match.term_zh)}」相同`
      : r.kind==='invalid' ? `缺少：${escapeHtml(r.missing.join('、'))}`
      : `${escapeHtml(t.category)} · ${statusLabel(t.status)} · ${VISIBILITY_LABEL[els.importVisibility?.value || t.visibility]}`;
    return `<div class="import-row"><div><strong>${escapeHtml(t.term_en||'（未填英文）')}｜${escapeHtml(t.term_zh||'（未填中文）')}</strong><small>${note}</small></div><div><small>${escapeHtml(t.source||'未填來源')}</small></div>${right}</div>`;
  }).join('');
  els.importPreview.classList.remove('hidden');
  document.querySelectorAll('[data-force-import]').forEach(box=>{
    box.addEventListener('change',()=>{ pendingImportRows[Number(box.dataset.forceImport)].force=box.checked; renderImportPreview(); });
  });
  const importable=counts.new + selectedReview;
  els.executeImportBtn.disabled=importable===0;
  els.executeImportBtn.textContent=`匯入 ${importable} 個詞彙`;
}

function analyzeBatchJson(){
  let parsed;
  try{
    parsed=JSON.parse(els.batchJson.value.trim());
  }catch(e){ showToast('JSON 格式錯誤，請檢查括號、逗號與雙引號。',true); return; }
  if(!Array.isArray(parsed)) parsed=[parsed];
  pendingImportRows=[];
  const localAccepted=[];
  for(const raw of parsed){
    const term=normalizeImportTerm(raw);
    const missing=validateImportTerm(term);
    if(missing.length){ pendingImportRows.push({kind:'invalid',term,missing,force:false}); continue; }
    const exact=findDuplicate(term.term_en,term.term_zh);
    if(exact){ pendingImportRows.push({kind:'skip',term,match:exact,force:false}); continue; }
    const localExact=localAccepted.find(x=>{
      const sameEn=normalizeTermKey(term.term_en) && normalizeTermKey(x.term_en)===normalizeTermKey(term.term_en);
      const sameZh=normalizeTermKey(term.term_zh) && normalizeTermKey(x.term_zh)===normalizeTermKey(term.term_zh);
      return sameEn || sameZh;
    });
    if(localExact){ pendingImportRows.push({kind:'skip',term,match:localExact,force:false}); continue; }
    const similar=findSimilar(term.term_en,term.term_zh);
    if(similar){ pendingImportRows.push({kind:'review',term,match:similar,force:false}); localAccepted.push(term); continue; }
    pendingImportRows.push({kind:'new',term,force:false});
    localAccepted.push(term);
  }
  renderImportPreview();
}

async function executeBatchImport(){
  if(!currentUser){ showToast('請先登入才能匯入',true); return; }
  const rows=pendingImportRows.filter(r=>r.kind==='new' || (r.kind==='review' && r.force));
  if(!rows.length){ showToast('沒有可匯入的詞彙',true); return; }
  const uid=currentUser.uid;
  const visibilityOverride=els.importVisibility?.value || '';
  els.executeImportBtn.disabled=true; els.executeImportBtn.textContent='匯入中…';
  try{
    // Same layout as single add: private copy always, plus a public or members copy with the same id.
    // 200 terms x up to 2 writes stays under Firestore's 500-op batch limit.
    for(let i=0;i<rows.length;i+=200){
      const batch=writeBatch(db);
      rows.slice(i,i+200).forEach(({term})=>{
        const ref=doc(personalTermsCollection(uid));
        const visibility=visibilityOverride || term.visibility;
        const data={...term,visibility,is_shared:visibility==='public',createdBy:uid,createdByName:currentUser.displayName||'',createdByEmail:currentUser.email||'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
        batch.set(ref,data);
        if(visibility==='public') batch.set(doc(termsRef,ref.id),data);
        if(visibility==='members') batch.set(doc(membersRef,ref.id),data);
      });
      await batch.commit();
    }
    showToast(`已匯入 ${rows.length} 個研究詞彙`);
    els.importDialog.close();
    resetImportDialog();
  }catch(e){ console.error(e); showToast(`批次匯入失敗：${e.message}`,true); renderImportPreview(); }
}

function updateDuplicateHint(){
  const en = els.termEn.value.trim();
  const zh = els.termZh.value.trim();
  const dup = findDuplicate(en, zh, els.termId.value);

  if(!en && !zh){
    els.duplicateHint.className = 'duplicate-hint hidden';
    els.duplicateHint.textContent = '';
    els.saveTermBtn.disabled = false;
    return null;
  }

  if(dup){
    const isMine = !!currentUser && dup.createdBy === currentUser.uid;
    els.duplicateHint.className = 'duplicate-hint duplicate';
    els.duplicateHint.textContent = isMine
      ? `⚠ 你已經新增過「${dup.term_en}｜${dup.term_zh}」，請直接編輯原有詞條。`
      : `⚠ 這個詞彙已存在：${dup.term_en}｜${dup.term_zh}（建立者：${ownerName(dup)}）。`;
    els.saveTermBtn.disabled = true;
    return dup;
  }

  const similar=findSimilar(en, zh, els.termId.value);
  if(similar){
    els.duplicateHint.className = 'duplicate-hint similar';
    els.duplicateHint.textContent = `△ 可能與「${similar.term_en}｜${similar.term_zh}」是相同或相近概念。你仍可新增，但建議先確認。`;
    els.saveTermBtn.disabled = false;
    return similar;
  }

  els.duplicateHint.className = 'duplicate-hint available';
  els.duplicateHint.textContent = '✓ 目前沒有找到相同或高度相近的詞彙，可以新增。';
  els.saveTermBtn.disabled = false;
  return null;
}

onAuthStateChanged(auth, user => {
  currentUser = user;
  els.loginBtn.classList.toggle('hidden', !!user);
  els.logoutBtn.classList.toggle('hidden', !user);
  els.addBtn.classList.toggle('hidden', !user);
  els.importBtn.classList.toggle('hidden', !user);
  els.mineWrap.classList.toggle('hidden', !user);
  if(!user) els.mineOnly.checked=false;
  subscribePrivateTerms(user);
  if(desktopSessionId && els.desktopAuthorizeBtn){
    els.desktopAuthorizeBtn.textContent=user?'授權此帳號給桌面版':'登入並授權桌面版';
  }
  render();
});

els.loginBtn.addEventListener('click', async()=>{
  if(desktopSessionId){ await authorizeDesktopLogin(); return; }
  try { await signInWithPopup(auth, provider); showToast('登入成功'); }
  catch(e){ console.error(e); showToast(`登入失敗：${e.code || e.message}`, true); }
});
els.desktopAuthorizeBtn?.addEventListener('click',authorizeDesktopLogin);
els.logoutBtn.addEventListener('click', async()=>{ await signOut(auth); showToast('已登出'); });
els.addBtn.addEventListener('click', ()=>openForm());
els.importBtn.addEventListener('click', ()=>{ resetImportDialog(); els.importDialog.classList.remove('dialog-enter'); void els.importDialog.offsetWidth; els.importDialog.classList.add('dialog-enter'); els.importDialog.showModal(); });
els.closeImportDialog.addEventListener('click', ()=>els.importDialog.close());
els.cancelImportDialog.addEventListener('click', ()=>els.importDialog.close());
els.analyzeImportBtn.addEventListener('click', analyzeBatchJson);
els.executeImportBtn.addEventListener('click', executeBatchImport);
els.batchFile.addEventListener('change', async()=>{ const file=els.batchFile.files?.[0]; if(!file) return; els.batchJson.value=await file.text(); analyzeBatchJson(); });
els.importVisibility?.addEventListener('change', ()=>{ if(pendingImportRows.length) renderImportPreview(); });
els.closeDialog.addEventListener('click', ()=>els.termDialog.close());
els.cancelDialog.addEventListener('click', ()=>els.termDialog.close());
els.termEn.addEventListener('input', updateDuplicateHint);
els.termZh.addEventListener('input', updateDuplicateHint);

function openForm(term=null){
  els.termForm.reset();
  els.termId.value=term?.id || '';
  $('modalEyebrow').textContent=term?'EDIT TERM':'NEW TERM';
  $('modalTitle').textContent=term?'編輯研究名詞':'新增研究名詞';
  if(term){
    els.termEn.value=term.term_en||''; els.termZh.value=term.term_zh||''; els.category.value=term.category||'';
    els.status.value=term.status||'general'; els.definition.value=term.definition||''; els.simpleExplanation.value=term.simple_explanation||'';
    els.example.value=term.example||''; els.researchNote.value=term.research_note||''; els.source.value=term.source||''; els.sourceType.value=term.sourceType||''; els.sourceDetail.value=term.sourceDetail||''; els.isCore.checked=!!term.is_core;
  }
  els.visibility.value=term?term.visibility||'private':'private';
  updateDuplicateHint();
  els.termDialog.classList.remove('dialog-enter');
  void els.termDialog.offsetWidth;
  els.termDialog.classList.add('dialog-enter');
  els.termDialog.showModal();
}

els.termForm.addEventListener('submit', async(e)=>{
  e.preventDefault();
  if(!currentUser){ showToast('請先登入',true); return; }
  const payload = {
    term_en:els.termEn.value.trim(), term_zh:els.termZh.value.trim(), category:els.category.value.trim()||'未分類', status:els.status.value,
    definition:els.definition.value.trim(), simple_explanation:els.simpleExplanation.value.trim(), example:els.example.value.trim(),
    research_note:els.researchNote.value.trim(), source:els.source.value.trim(), sourceType:els.sourceType.value.trim(), sourceDetail:els.sourceDetail.value.trim(), is_core:els.isCore.checked, visibility:els.visibility.value
  };
  const duplicate = findDuplicate(payload.term_en, payload.term_zh, els.termId.value);
  if(duplicate){
    const isMine = duplicate.createdBy === currentUser.uid;
    showToast(isMine ? '你已經新增過這個詞彙' : '這個詞彙已經存在', true);
    updateDuplicateHint();
    return;
  }
  try{
    const original=els.termId.value?terms.find(t=>t.id===els.termId.value):null;
    if(original && !canEdit(original)) throw new Error('你只能修改自己建立的詞條');
    const termId=els.termId.value || doc(personalTermsCollection(currentUser.uid)).id;
    await syncPersonalTerm(termId,payload,original);
    showToast(original?'詞條已更新':'詞條已新增');
    els.termDialog.close();
  }catch(err){ console.error(err); showToast(`儲存失敗：${err.message}`,true); }
});

function openDetail(term){
  const chips = `${term.is_core?'<span class="chip core">★ 核心</span>':''}<span class="chip ${term.status==='pending'?'pending':term.status==='candidate'?'candidate':''}">${statusLabel(term.status)}</span><span class="chip">${escapeHtml(term.category)}</span><span class="chip ${term.visibility!=='public'?'private':''}">${VISIBILITY_LABEL[term.visibility]||'共享'}</span>`;
  els.detailContent.innerHTML=`
    <button class="icon-btn detail-close" onclick="document.getElementById('detailDialog').close()">×</button>
    <div class="detail-header"><div class="detail-title"><p class="eyebrow">RESEARCH TERM</p><h2>${escapeHtml(term.term_en)}</h2><h3>${escapeHtml(term.term_zh)}</h3><div class="chips">${chips}</div></div></div>
    <div class="detail-section"><h4>正式定義</h4><p>${escapeHtml(term.definition||'—')}</p></div>
    <div class="detail-section"><h4>白話解釋</h4><p>${escapeHtml(term.simple_explanation||'—')}</p></div>
    <div class="detail-section"><h4>例子</h4><p>${escapeHtml(term.example||'—')}</p></div>
    <div class="detail-section"><h4>與研究的關係</h4><p>${escapeHtml(term.research_note||'—')}</p></div>
    <div class="detail-section"><h4>來源</h4><p>${escapeHtml(term.source||'—')}</p></div>
    ${term.sourceType?`<div class="detail-section"><h4>來源類型</h4><p>${escapeHtml(term.sourceType)}</p></div>`:''}
    ${term.sourceDetail?`<div class="detail-section"><h4>來源位置</h4><p>${escapeHtml(term.sourceDetail)}</p></div>`:''}
    <div class="detail-section"><p class="owner">建立者：${escapeHtml(ownerName(term))}</p></div>`;
  els.detailDialog.classList.remove('dialog-enter');
  void els.detailDialog.offsetWidth;
  els.detailDialog.classList.add('dialog-enter');
  els.detailDialog.showModal();
}

async function removeTerm(term){
  if(!canEdit(term)){ showToast('你只能刪除自己建立的詞條',true); return; }
  if(!confirm(`確定刪除「${term.term_en}｜${term.term_zh}」？`)) return;
  try{ await deletePersonalTerm(term); showToast('詞條已刪除'); }
  catch(e){ showToast(`刪除失敗：${e.message}`,true); }
}

function render(){
  const search=els.searchInput.value.trim();
  const cat=els.categoryFilter.value;
  const status=els.statusFilter.value;
  const hasSearch=Boolean(search);

  let filtered=terms
    .map(t=>({term:t, searchScore:hasSearch?scoreSearchMatch(t,search):0}))
    .filter(({term:t,searchScore})=>
      (!hasSearch || searchScore>=0) &&
      (!cat || t.category===cat) &&
      (!status || t.status===status) &&
      (!els.coreOnly.checked || t.is_core) &&
      (!els.mineOnly.checked || t.createdBy===currentUser?.uid)
    );

  filtered.sort((a,b)=>{
    if(hasSearch && b.searchScore!==a.searchScore) return b.searchScore-a.searchScore;
    return (Number(b.term.is_core)-Number(a.term.is_core)) ||
      (a.term.category||'').localeCompare(b.term.category||'','zh-Hant') ||
      (a.term.term_en||'').localeCompare(b.term.term_en||'','en');
  });

  const visibleTerms=filtered.map(item=>item.term);
  els.termsGrid.innerHTML=visibleTerms.map((t,index)=>`
    <article class="term-card term-enter" style="--delay:${Math.min(index,18)*22}ms">
      <div class="term-top"><div><p class="eyebrow">${escapeHtml(t.category||'UNCATEGORIZED')}</p><h3>${escapeHtml(t.term_en)}</h3><p class="term-zh">${escapeHtml(t.term_zh)}</p></div>${t.is_core?'<span class="core-star" title="核心詞彙">★</span>':''}</div>
      <p class="term-explain">${escapeHtml(t.simple_explanation||t.definition||'')}</p>
      <div class="chips"><span class="chip ${t.status==='pending'?'pending':t.status==='candidate'?'candidate':''}">${statusLabel(t.status)}</span>${t.is_core?'<span class="chip core">核心</span>':''}<span class="chip ${t.visibility!=='public'?'private':''}">${VISIBILITY_LABEL[t.visibility]||'共享'}</span></div>
      <div class="card-actions"><button class="link-btn" data-detail="${t.id}">查看完整內容 →</button><div class="mini-actions">${canEdit(t)?`<button data-edit="${t.id}">編輯</button><button class="delete" data-delete="${t.id}">刪除</button>`:''}</div></div>
    </article>`).join('');

  const activeFilters=[cat,status,els.coreOnly.checked,els.mineOnly.checked].filter(Boolean).length;
  els.resultCount.textContent=`${visibleTerms.length} 個詞彙`;
  els.resultContext.textContent=hasSearch ? `搜尋「${search}」` : (activeFilters ? '已套用篩選條件' : '顯示全部研究詞彙');
  els.clearSearchBtn.classList.toggle('hidden',!hasSearch);
  els.activeFilterCount.textContent=activeFilters;
  els.activeFilterCount.classList.toggle('hidden',activeFilters===0);
  els.noResultsText.textContent=hasSearch
    ? `找不到與「${search}」相符的詞彙。可減少關鍵字，或清除分類與狀態篩選。`
    : '目前的篩選條件沒有符合詞彙，請嘗試清除部分條件。';

  els.noResults.classList.toggle('hidden',visibleTerms.length>0 || terms.length===0);
  els.emptySetup.classList.toggle('hidden',terms.length>0 || !currentUser || currentUser.uid !== ADMIN_UID);
  document.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>openDetail(terms.find(t=>t.id===b.dataset.detail)));
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openForm(terms.find(t=>t.id===b.dataset.edit)));
  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>removeTerm(terms.find(t=>t.id===b.dataset.delete)));
  refreshCategories();
}

function refreshCategories(){
  const cats=[...new Set(terms.map(t=>t.category).filter(Boolean))].sort(); const selected=els.categoryFilter.value;
  els.categoryFilter.innerHTML='<option value="">所有分類</option>'+cats.map(c=>`<option ${c===selected?'selected':''}>${escapeHtml(c)}</option>`).join('');
  els.categoryList.innerHTML=cats.map(c=>`<option value="${escapeHtml(c)}"></option>`).join('');
}

updateThemeButton();
initFontScale();
setupDesktopAuthBanner();
els.themeToggle?.addEventListener('click',toggleTheme);
els.fontSizeSlider?.addEventListener('input',event=>applyFontScale(event.target.value));

const debouncedSearchRender=debounce(render,250);
els.searchInput.addEventListener('input',debouncedSearchRender);
els.searchInput.addEventListener('search',render);
[els.categoryFilter,els.statusFilter,els.coreOnly,els.mineOnly].forEach(el=>el.addEventListener('change',render));

els.clearSearchBtn.addEventListener('click',()=>{
  els.searchInput.value='';
  els.searchInput.focus();
  render();
});

els.clearFiltersBtn.addEventListener('click',()=>{
  els.searchInput.value='';
  els.categoryFilter.value='';
  els.statusFilter.value='';
  els.coreOnly.checked=false;
  els.mineOnly.checked=false;
  render();
});

els.filterToggle.addEventListener('click',()=>{
  const open=els.filterPanel.classList.toggle('mobile-open');
  els.filterToggle.setAttribute('aria-expanded',String(open));
});

document.addEventListener('keydown',event=>{
  if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k'){
    event.preventDefault();
    els.searchInput.focus();
    els.searchInput.select();
  }
  if(event.key==='Escape' && document.activeElement===els.searchInput && els.searchInput.value){
    els.searchInput.value='';
    render();
  }
});

onSnapshot(query(termsRef), snap=>{
  publicTerms=snap.docs.map(d=>({id:d.id,...d.data(),is_shared:true,_origin:'public'}));
  mergeVisibleTerms();
}, err=>{
  console.error(err); showToast('讀取 Firestore 失敗，請確認資料庫與 Security Rules。',true);
});

const seedTerms = [
['LLM','大型語言模型','LLM / 基礎','以大量文本訓練、能理解與生成自然語言的模型。','像 Qwen、Llama 這類可以理解問題並生成文字的模型。','Qwen3 可作為問答系統中的推理或回答模型。','研究中的生成、推理與判斷核心。','基礎概念','general',false],
['QA','問答','LLM / 基礎','Question Answering，根據問題產生答案的任務。','輸入一個問題，系統要找出或生成合理答案。','輸入「水鹿感染結核病有哪些症狀？」並產生回答。','本研究最終仍以問答品質作為重要結果。','侯宇炯論文','general',false],
['RAG','檢索增強生成','RAG / Retrieval','在生成答案前先從外部知識來源檢索相關證據，再讓語言模型依證據生成。','先查資料，再回答。','先從鹿科知識庫找結核病相關片段，再交給 LLM 回答。','侯學長系統與後續研究的基礎架構。','侯宇炯論文；RAG literature','confirmed',true],
['Retrieval','檢索','RAG / Retrieval','依 Query 從語料庫或知識庫找出相關文件、段落或證據。','把現在想查的內容丟進知識庫找資料。','以「幼年水鹿 結核病 症狀」搜尋相關 chunks。','IRCoT 每一輪的重要步驟。','IRCoT；侯宇炯論文','confirmed',true],
['Retriever','檢索器','RAG / Retrieval','執行 Retrieval 的模型或演算法元件。','真正負責搜尋資料的模組。','BM25、BGE-M3 都可以扮演檢索元件。','用來比較不同 Query 是否真的改善檢索。','侯宇炯論文','general',false],
['Corpus','語料庫','Knowledge Base','供檢索與模型使用的一組文本集合。','系統所有可以查的資料。','臺灣鹿疾病、繁殖、營養、場域紀錄等資料。','研究的外部知識來源。','侯宇炯論文','general',false],
['Chunk','語料切片','Knowledge Base','將長文件切分成較小的文字單位，以利嵌入與檢索。','把長 PDF 或文章切成一小段一小段。','一篇疾病手冊可切成多個段落，每段建立向量。','Retrieval 實際搜尋的基本單位之一。','侯宇炯論文','general',false],
['Evidence','證據','Reasoning / Evidence','由檢索取得、用來支持推理或最終回答的文本資訊。','模型回答時可以拿來當依據的資料。','鹿科疾病指南中的症狀描述。','Evidence Decision 與回答忠實性的核心。','侯宇炯論文','confirmed',true],
['Context','上下文／語境','Reasoning / Evidence','模型於當下推理或生成時可見的問題、證據、歷史輸出等資訊。','模型現在手上看得到的資料。','原始問題 + 已檢索證據 + 前幾輪推理。','Context Drift 與 S2G-RAG 都會涉及。','侯宇炯論文；S2G-RAG','confirmed',true],
['Embedding','向量嵌入','RAG / Retrieval','把文字映射成數值向量，以便計算語意相似度。','把文字變成一串數字，讓電腦比較意思像不像。','「鹿結核病」與相關疾病段落的向量距離較近。','Dense Retrieval 的基礎。','侯宇炯論文','general',false],
['Vector Database','向量資料庫','RAG / Retrieval','儲存向量並支援相似度搜尋的資料庫或索引系統。','專門存 Embedding 並快速找相似資料。','將鹿科 chunks 的 BGE-M3 向量存入向量資料庫。','提供語意檢索服務。','侯宇炯論文','general',false],
['Dense Retrieval','稠密檢索','RAG / Retrieval','以語意向量相似度進行文件搜尋。','比較「意思像不像」來找資料。','BGE-M3 將 Query 與 chunks 向量化後搜尋。','與 BM25 互補形成 Hybrid Retrieval。','侯宇炯論文','confirmed',false],
['Sparse Retrieval','稀疏檢索','RAG / Retrieval','主要依字詞匹配與詞頻特徵進行檢索。','比較偏關鍵字搜尋。','專有疾病名稱可透過 BM25 精準命中。','補足 Dense Retrieval 對罕見詞的不足。','侯宇炯論文','confirmed',false],
['BM25','BM25 檢索演算法','RAG / Retrieval','根據查詢字詞、詞頻與文件長度等因素計算文件相關性。','很常用的關鍵字檢索演算法。','以「結核病」等關鍵字排序知識庫段落。','侯學長 Hybrid Retrieval 的一部分。','侯宇炯論文','confirmed',false],
['Hybrid Retrieval','混合檢索','RAG / Retrieval','結合稠密與稀疏檢索，以同時利用語意與字詞匹配能力。','語意搜尋 + 關鍵字搜尋一起用。','BGE-M3 + BM25。','侯學長檢索架構的重要基礎。','侯宇炯論文','confirmed',true],
['RRF','倒數排名融合','RAG / Retrieval','Reciprocal Rank Fusion，將多個檢索器的排名結果整合成單一排序。','把不同搜尋方法的名次融合。','融合 BGE-M3 與 BM25 的候選結果。','Hybrid Retrieval 的融合方法。','侯宇炯論文','confirmed',false],
['Reranker','重排序模型','RAG / Retrieval','對初步候選文件進一步計分與排序，以提升前幾名結果的相關性。','先找一批，再用更精準模型重新排。','bge-reranker-v2-m3 對候選 chunks 重排。','影響最終送給 LLM 的 Evidence 品質。','侯宇炯論文','confirmed',false],
['Top-K','前 K 筆結果','Evaluation / Retrieval','只保留檢索排序中前 K 個候選結果。','搜尋結果只拿前幾筆。','Final Top-5 Evidence。','用來控制檢索內容量與評估 Recall@K。','侯宇炯論文','general',false],
['CoT','思維鏈推理','Reasoning / IRCoT','Chain-of-Thought，將複雜問題拆成連續的中間推理步驟。','不要直接跳到答案，而是一步一步推。','先判斷疾病，再找症狀證據，再形成答案。','IRCoT 的推理核心。','侯宇炯論文；CoT literature','confirmed',true],
['Multi-hop Reasoning','多步推理','Reasoning / IRCoT','需要串接多個中間資訊或多份證據才能完成的推理。','一份資料不夠，要查好幾步。','先找疾病，再找特定年齡的症狀資訊。','IRCoT 與 S2G-RAG 的主要應用場景。','IRCoT；S2G-RAG','confirmed',true],
['IRCoT','交錯式檢索思維鏈','Reasoning / IRCoT','Interleaved Retrieval with Chain-of-Thought，交替執行推理與檢索，讓推理影響下一次搜尋、搜尋結果再影響後續推理。','邊想邊查、查完再繼續想。','Retrieval → Reasoning → Retrieval → Reasoning。','侯學長系統與本研究延伸的直接基線。','Trivedi et al., ACL 2023；侯宇炯論文','confirmed',true],
['q_t','第 t 輪查詢','Reasoning / IRCoT','第 t 輪用於 Retrieval 的目前 Query。','現在這一輪拿去搜尋的文字。','q₂ 可能是「幼年水鹿 結核病 臨床症狀」。','Context Drift Detector 要觀察各輪 Query 變化。','侯宇炯論文','confirmed',true],
['D_t','第 t 輪檢索證據','Reasoning / IRCoT','使用 q_t 從知識庫檢索得到的第 t 輪證據集合。','這一輪查回來的資料。','用 q₂ 找到的 5 個相關鹿結核病 chunks。','影響 r_t 與下一輪 Query Rewrite。','侯宇炯論文','confirmed',true],
['r_t','第 t 輪中間推理','Reasoning / IRCoT','模型根據 q_t 與 D_t 產生的中間推理狀態。','模型看完這輪問題和資料後，目前想到什麼。','判斷仍缺少幼年個體專屬症狀資訊。','侯學長 Rewrite 公式的輸入之一。','侯宇炯論文','confirmed',true],
['q_(t+1)','下一輪查詢','Reasoning / IRCoT','由目前 q_t、r_t 與 D_t 改寫產生、供下一輪 Retrieval 使用的 Query。','下一輪準備拿去查的新問題。','q₃：「幼年水鹿 結核病 呼吸道症狀」。','本研究可能在它送進 Retrieval 前加入 Drift Detection。','侯宇炯論文','confirmed',true],
['Query Rewrite','查詢改寫','Query / Rewrite','依目前問題、證據或推理狀態重新產生更適合檢索的 Query。','把搜尋句重新整理，讓下一輪更容易找到缺的資料。','從「水鹿結核病」改成「幼年水鹿結核病症狀」。','侯學長已做到，本研究不是重新發明 Rewrite。','侯宇炯論文','confirmed',true],
['Evidence Decision','證據決策','Reasoning / Evidence','判斷目前證據是否足以回答、是否需繼續檢索或應輸出證據不足。','判斷「現在找到的資料夠不夠」。','answerable / need_more_retrieval / insufficient_evidence。','侯學長已實作，不應當成新研究貢獻。','侯宇炯論文','confirmed',true],
['Evidence Sufficiency','證據充分性','Reasoning / Evidence','衡量目前累積證據是否足以支持回答問題。','現在資料夠不夠回答。','若缺少幼年個體資訊，就可能判定不足。','與 Context Drift 不同：一個看證據夠不夠，一個看 Query 是否偏移。','侯宇炯論文；S2G-RAG','confirmed',true],
['Search Refinement','檢索細化','Query / Rewrite','當現有證據不足時，依資訊缺口產生更聚焦的後續檢索 Query。','知道缺什麼後，把下一次搜尋寫得更精準。','缺少年齡條件資訊，因此下一輪加上「幼年」。','侯學長 IRCoT 流程已有此階段。','侯宇炯論文','confirmed',false],
['Task Classification','任務分類','Query / Intent','將輸入問題判斷為特定任務類型，以利後續選擇適合的處理或推理方式。','先判斷使用者到底在問哪一種事情。','「有哪些症狀？」可分為疾病症狀查詢。','子計畫第一年明列模組；可作為後續 Drift 判斷的任務訊號。','子計畫一研究計畫書','confirmed',true],
['Intent Detection','意圖辨識','Query / Intent','辨識使用者問題背後希望取得的資訊或操作意圖。','看使用者真正想知道什麼。','症狀、治療、劑量、繁殖管理可能是不同意圖。','與 Task Classification 密切相關，但不完全等同。','子計畫一研究計畫書','confirmed',false],
['Entity','實體','Query / Semantics','問題或文本中具明確指涉的對象、概念或專業實體。','問題裡在講的「誰」或「什麼」。','水鹿、結核病。','可用於檢查 Query Rewrite 是否把關鍵對象改掉。','Q2EI；侯宇炯論文','confirmed',true],
['Constraint','限制條件','Query / Semantics','限定問題適用範圍、情境或答案條件的資訊。','問題裡不能隨便丟掉的條件。','幼年、特定時間點、劑量、鹿種。','可能成為 Context Drift Detection 的重要訊號。','本研究工作定義；需持續文獻驗證','pending',true],
['Entity / Constraint Preservation','實體／限制條件保留','Query / Drift','檢查 Query Rewrite 後是否仍保留回答原始問題所需的重要實體與限制條件。','改寫之後，重要的人事物和條件還在不在。','原本有「幼年」，q₃ 若刪掉就可能是條件遺失。','目前屬候選研究設計，尚不是計畫書定義死的演算法。','本研究候選方法','pending',true],
['Context Drift','語境漂移／語境變化','Query / Drift','多輪處理中，當前查詢或語境逐漸偏離原始問題需求或目前任務需求的現象。','越改寫越偏題。','幼年水鹿結核病症狀 → 結核病一般症狀。','子計畫第二年明列 Context Drift Detector。','子計畫一研究計畫書；相關文獻待驗證','pending',true],
['Semantic Drift','語意漂移','Query / Drift','改寫、擴寫或生成後的表示與原始語意逐漸產生偏離。','文字看起來相關，但真正意思已經被帶偏。','Query Expansion 加入不相關細節後，Retriever 被帶去錯誤文件。','Q2EI 明確討論冗餘生成可能造成 Semantic Drift。','Q2EI, ACL Findings 2026','confirmed',true],
['Entity Drift','實體漂移','Query / Drift','改寫過程中核心實體被替換、泛化或變成另一個實體的情況。','原本的對象被換掉。','水鹿 → 鹿科 → 反芻動物。','目前可作為 Drift Taxonomy 候選類型。','本研究候選分類','pending',false],
['Constraint Drift','限制條件漂移','Query / Drift','改寫過程中原始必要限制被遺失、弱化或改變。','重要條件不見或變掉。','「幼年水鹿」變成「水鹿」。','目前可作為 Drift Taxonomy 候選類型。','本研究候選分類','pending',true],
['Intent Drift','意圖漂移','Query / Drift','改寫後的查詢意圖與原始問題所需資訊類型不一致。','原本問症狀，後來變成查治療。','症狀查詢 → 治療方式查詢。','目前可作為 Drift Taxonomy 候選類型。','本研究候選分類','pending',false],
['Scope Drift','範圍漂移','Query / Drift','改寫後問題範圍相較原始需求過度擴大或縮小。','查詢範圍被放太大或縮太小。','水鹿疾病 → 所有鹿科疾病。','侯學長回饋機制已有 scope guard 概念，但此分類仍需文獻界定。','本研究候選分類','pending',false],
['Unsupported Addition','無依據新增條件','Query / Drift','改寫 Query 時加入原問題與證據均未支持的新條件。','模型自己多加了原本沒說的限制。','原本沒提懷孕，Query 卻加入「懷孕母鹿」。','可能造成後續檢索方向錯誤。','本研究候選分類','pending',false],
['Context Drift Detector','語境變化偵測模組','Query / Drift','用來辨識多輪查詢或語境是否發生不合理偏移的模組。','每次 Rewrite 後先檢查有沒有偏掉。','比較 q₀、任務需求與 q_(t+1) 是否一致。','子計畫第二年正式工作項目之一；具體方法仍待設計。','子計畫一研究計畫書','confirmed',true],
['Semantic Correction','語意修正','Query / Drift','偵測到不合理語意偏移後，對查詢或候選表示進行修正，使其重新符合任務需求。','發現 Query 改壞了，就把它修回來。','「水鹿結核病症狀」修正為「幼年水鹿結核病症狀」。','子計畫第二年 Semantic Correction & Candidate Update 的一部分。','子計畫一研究計畫書','confirmed',true],
['Candidate Update','候選更新','Query / Drift','依計畫書名稱指在語意修正後更新後續使用的候選項目；其 Candidate 的精確定義尚需確認。','修正後，把新的候選內容更新回流程。','可能是 Query Candidate，也可能包含 Retrieval Candidate。','目前不能自行斷定 Candidate 一定指 Query。','子計畫一研究計畫書','pending',true],
['Q2EI','Query-to-Entity Inference','Query / Q2EI','一種以核心實體推論為中心的查詢改寫方法，將非專業描述濃縮為實體中心 Query。','先猜使用者真正指的是哪個專業實體，再用那個實體去查。','現象描述 → 推論疾病實體 → entity-centric query。','是本研究在 Semantic Drift 與 Query Rewrite 上的重要比較文獻。','Q2EI, ACL Findings 2026','confirmed',true],
['GQC','生成式查詢濃縮','Query / Q2EI','Generative Query Condensation，將查詢濃縮成資訊密度較高的核心表示。','不是把 Query 寫更長，而是把雜訊拿掉。','把冗長醫療症狀描述濃縮成核心疾病概念。','Q2EI 用來降低冗餘與 Semantic Drift。','Q2EI, ACL Findings 2026','confirmed',false],
['GQE','生成式查詢擴展','Query / Q2EI','Generative Query Expansion，透過生成更多描述或偽文件擴充原始 Query。','把搜尋句寫得更長、更豐富。','HyDE、Query2Doc 類方法。','Q2EI 指出專業領域中過度擴展可能導致雜訊與 Drift。','Q2EI, ACL Findings 2026','confirmed',false],
['Semantic Condensation','語意濃縮','Query / Q2EI','保留核心概念並移除冗餘內容，使查詢表示更緊湊、資訊密度更高。','把一句很長的話縮成最重要的意思。','症狀描述 → 核心疾病實體。','Q2EI 的核心設計思想。','Q2EI, ACL Findings 2026','confirmed',true],
['Lexical Mismatch','詞彙不匹配','Query / Q2EI','使用者問句與專業文件使用不同詞彙表達相同概念，導致檢索困難。','講的是同一件事，但用詞完全不同。','一般人描述「認不出臉」而文件寫 prosopagnosia。','Q2EI 嘗試把 lay query 對齊專業詞彙空間。','Q2EI, ACL Findings 2026','confirmed',false],
['Semantic Gap','語意落差','Query / Q2EI','查詢與目標知識之間存在概念層次或表示空間差距。','使用者的說法和專業知識的說法差太遠。','現象層描述與專業疾病名稱之間的落差。','Domain-specific Retrieval 的重要問題。','Q2EI, ACL Findings 2026','confirmed',false],
['Information Density','資訊密度','Query / Q2EI','查詢中真正有助於定位目標知識的有效資訊相對於總內容的集中程度。','有用資訊佔多少，廢話有多少。','短但精準的 entity-centric query 可能比長擴寫更有效。','Q2EI 用來說明冗餘與 Drift 的關係。','Q2EI, ACL Findings 2026','confirmed',false],
['S2G-RAG','結構化充分性與缺口判斷 RAG','Reasoning / S2G-RAG','Structured Sufficiency and Gap-judging RAG，以顯式控制器判斷證據充分性並產生結構化資訊缺口，再形成下一輪查詢。','每一輪先問「資料夠不夠？不夠的話缺什麼？」再去查。','q + C_t → S2G-Judge → gap items → next query。','是 Evidence Sufficiency 與 Iterative Retrieval 的重要比較文獻。','S2G-RAG, ACL 2026','confirmed',true],
['S2G-Judge','S2G 判斷器','Reasoning / S2G-RAG','S2G-RAG 中每輪判斷現有 Evidence Context 是否足夠，並在不足時產生結構化 Gap Items 的控制器。','負責判斷「夠不夠、缺什麼」。','輸出 sufficient=true/false 與 gap items。','提醒本研究不要把 Evidence Sufficiency 當成全新概念。','S2G-RAG, ACL 2026','confirmed',true],
['Structured Gap Item','結構化資訊缺口','Reasoning / S2G-RAG','用固定欄位描述目前回答問題尚缺少的資訊，供下一輪 Query Construction 使用。','把「還缺什麼」整理成固定格式。','缺少某實體的某個屬性。','比自由文字更容易控制 Next-hop Query。','S2G-RAG, ACL 2026','confirmed',false],
['Evidence Context','累積證據語境','Reasoning / S2G-RAG','在多輪檢索中保留下來、供後續判斷與回答使用的精簡證據集合。','到目前為止系統真正留下來的有效證據。','C_t 隨每輪 Evidence Extractor 更新。','避免長篇多輪內容全部堆進模型造成雜訊。','S2G-RAG, ACL 2026','confirmed',false],
['Bridge Entity','橋接實體','Reasoning / Multi-hop','在多步問題中，連接前一跳與下一跳檢索需求的中間實體。','第一步找到它，第二步拿它繼續查。','電影 → 導演姓名 → 導演出生國家。','理解 Multi-hop Query Construction 很重要。','Multi-hop QA literature','confirmed',false],
['Noise','雜訊','RAG / Retrieval','與當前任務無關或會干擾檢索、推理的資訊。','會讓模型分心的內容。','檢索到看似相關但與問題條件不符的段落。','多輪 Retrieval 容易逐步累積 Noise。','Q2EI；S2G-RAG','confirmed',false],
['Redundancy','冗餘','RAG / Retrieval','重複或不必要、未增加有效資訊的內容。','資訊重複太多。','Query Expansion 生成大量相似描述。','Q2EI 認為冗餘可能降低 Information Density。','Q2EI, ACL Findings 2026','confirmed',false],
['Distractor','干擾證據','RAG / Retrieval','表面相關但可能導致模型做出錯誤判斷的檢索內容。','看起來很像答案，但其實會帶錯方向。','同樣談結核病但不是水鹿或不是指定年齡。','S2G-RAG 會處理 distractor-heavy context 問題。','S2G-RAG, ACL 2026','confirmed',false],
['Hallucination','幻覺','LLM / 基礎','模型生成缺乏可靠證據支持、甚至不存在的內容。','模型很有自信地講錯或自己編。','證據沒有劑量資料，模型卻自行給出數字。','RAG、Evidence Decision、Faithfulness 都與降低幻覺相關。','侯宇炯論文；RAG literature','confirmed',true],
['Self-Consistency','自我一致性','Reasoning / Strategy','透過多次採樣不同推理路徑，再依答案一致程度選擇代表輸出的推理增強策略。','同一題多想幾次，看答案是不是集中到同一結果。','多次生成後用語意聚類收斂。','侯學長已有，不等同 Context Drift Detection。','侯宇炯論文','confirmed',false],
['Fine-tuning','微調','Training','使用特定任務或領域資料繼續訓練既有模型，使其行為更符合需求。','拿現成模型，再用自己的資料教它。','用鹿科 IRCoT 標註資料訓練 Qwen。','侯學長模型訓練的一部分。','侯宇炯論文','confirmed',false],
['SFT','監督式微調','Training','Supervised Fine-Tuning，利用已知輸入與目標輸出資料進行模型微調。','給模型標準答案，讓它照著學。','訓練 IRCoT 決策格式與推理輸出。','侯學長採用的訓練方法之一。','侯宇炯論文','confirmed',false],
['LoRA','低秩適應','Training','Low-Rank Adaptation，以少量可訓練參數調整大型模型，降低微調成本。','不用把整個大模型都重訓，只調一小部分。','Qwen + LoRA adapter。','侯學長 LoRA-SFT 的基礎。','侯宇炯論文','confirmed',false],
['Parent-to-Round','Parent-to-Round 兩階段訓練','Training','先建立較完整的全局推理能力，再以 round-level 資料進一步校準單輪決策與輸出一致性。','先學整體怎麼推，再學每一輪怎麼做細。','Parent-level 初始化後再做 Round-level 微調。','侯學長最終主要 IRCoT 模型設定。','侯宇炯論文','confirmed',true],
['Recall@K','前 K 筆召回率','Evaluation / Retrieval','衡量前 K 個檢索結果涵蓋了多少應該被找到的相關項目。','該找的資料有沒有被找進前 K 筆。','Recall@5。','可評估 Drift Correction 是否改善檢索覆蓋。','侯宇炯論文','confirmed',true],
['Precision@K','前 K 筆精確率','Evaluation / Retrieval','衡量前 K 個檢索結果中有多少是真正相關的項目。','找回來的前 K 筆有多少不是垃圾。','Precision@5。','可觀察修正後 Query 是否降低無關結果。','侯宇炯論文','confirmed',false],
['MRR','平均倒數排名名次','Evaluation / Retrieval','Mean Reciprocal Rank，衡量第一個相關結果出現在排名中的位置，越前面分數越高。','第一個正確資料排得有多前面。','第一個相關段落排第 1 比排第 10 好。','侯學長用於比較 Query Rewrite 的排序品質。','侯宇炯論文','confirmed',true],
['Faithfulness','忠實性','Evaluation / Generation','衡量答案中的主張是否能被提供的 Evidence 支持。','回答有沒有照證據講，而不是自己編。','答案中的症狀都能在檢索片段找到依據。','用來評估回答可信度。','侯宇炯論文 / RAGAS','confirmed',true],
['Answer Relevancy','答案相關性','Evaluation / Generation','衡量生成答案與使用者問題的相關程度。','有沒有真的回答到問題。','問症狀卻大量回答治療方式，相關性就會下降。','可觀察 Intent Drift 對最終回答的影響。','侯宇炯論文 / RAGAS','confirmed',false],
['Context Precision','語境精確度','Evaluation / Retrieval','衡量檢索出的 Context 是否把真正相關內容排在前面。','找回來的脈絡是不是大多有用而且排得前。','高比例相關 chunks 出現在前幾名。','侯學長主要 RAGAS Context 指標之一。','侯宇炯論文 / RAGAS','confirmed',false],
['Context Recall','語境召回率','Evaluation / Retrieval','衡量檢索 Context 對回答所需資訊的涵蓋程度。','該找的資訊有沒有找齊。','答案需要三項證據，Context 是否涵蓋。','可評估多輪 Query 改寫與修正效果。','侯宇炯論文 / RAGAS','confirmed',false]
];

els.seedBtn.addEventListener('click', async()=>{
  if(!currentUser || currentUser.uid !== ADMIN_UID){ showToast('只有管理員可以匯入初始辭典',true); return; }
  if(terms.length){ showToast('已有詞條，不需要匯入',true); return; }
  els.seedBtn.disabled=true; els.seedBtn.textContent='匯入中…';
  try{
    const existing=await getDocs(termsRef); if(!existing.empty) throw new Error('資料庫已有詞條');
    const chunkSize=400;
    for(let i=0;i<seedTerms.length;i+=chunkSize){
      const batch=writeBatch(db);
      seedTerms.slice(i,i+chunkSize).forEach(([term_en,term_zh,category,definition,simple_explanation,example,research_note,source,status,is_core])=>{
        const ref=doc(termsRef);
        batch.set(ref,{term_en,term_zh,category,definition,simple_explanation,example,research_note,source,status,is_core,createdBy:currentUser.uid,createdByName:currentUser.displayName||'',createdByEmail:currentUser.email||'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      });
      await batch.commit();
    }
    showToast(`已匯入 ${seedTerms.length} 個研究名詞`);
  }catch(e){ console.error(e); showToast(`匯入失敗：${e.message}`,true); }
  finally{ els.seedBtn.disabled=false; els.seedBtn.textContent='匯入初始研究辭典'; }
});
