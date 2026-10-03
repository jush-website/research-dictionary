import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const desktop = readFileSync(new URL('../desktop/src/main.js', import.meta.url), 'utf8');
const web = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
// Run the production functions with isolated storage/network/SDK adapters.
function harness(source, names, overrides = {}) {
  const context = vm.createContext({
    console: { error() {}, warn() {} }, Date, URLSearchParams,
    crypto: { randomUUID }, setTimeout() {},
    currentUser: { uid: 'alice', displayName: 'Alice' }, terms: [],
    publicTerms: [], privateTerms: [], memberTerms: [],
    COLLECTION_NAME: 'research_dictionary', PRIVATE_ROOT: 'user_research_dictionary',
    MEMBERS_COLLECTION: 'member_research_dictionary', ADMIN_UID: 'admin',
    FIRESTORE_DOC_PREFIX: 'projects/test/databases/(default)/documents/',
    DISPLAY_LIMIT_OPTIONS: [36, 72, 144, 300, 0], DISPLAY_LIMIT_KEY: 'limit',
    CACHE_KEY: 'cache', AUTH_SESSION_KEY: 'auth', loadGeneration: 0,
    render() {}, showToast() {}, loadTerms: async () => {}, confirm: () => true,
    ...overrides,
  });
  for (const name of names) {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`, 'm'));
    assert.ok(match, `production function ${name} exists`);
    vm.runInContext(match[0], context);
  }
  return context;
}
const ids = value => Array.from(value, t => t.id);

test('first launch defaults to 72; explicit all and other limits persist', () => {
  for (const [raw, expected] of [[null,72],['',72],['0',0],['144',144],['bad',72]]) {
    const h = harness(desktop, ['loadDisplayLimit'], { localStorage: { getItem: () => raw } });
    assert.equal(h.loadDisplayLimit(), expected);
  }
});

test('offline cache respects signed-out, members, and account ownership', () => {
  const cached = [
    { id:'public',visibility:'public' }, { id:'member',visibility:'members' },
    { id:'alice',visibility:'private',createdBy:'alice' },
    { id:'bob',visibility:'private',createdBy:'bob' },
  ];
  const h = harness(desktop, ['visibleCachedTerms']);
  assert.deepEqual(ids(h.visibleCachedTerms(cached)), ['public','member','alice']);
  h.currentUser = {uid:'bob'};
  assert.deepEqual(ids(h.visibleCachedTerms(cached)), ['public','member','bob']);
  h.currentUser = null;
  assert.deepEqual(ids(h.visibleCachedTerms(cached)), ['public']);
  assert.equal(h.visibleCachedTerms({}).length, 0);
  assert.equal(h.visibleCachedTerms([null, 123]).length, 0);
});

test('selection lookup clears unrelated filters and opens the exact term', async () => {
  const term={id:'rag',term_en:'RAG',term_zh:'檢索增強生成'};
  const h=harness(desktop,['normalize','exactMatch','lookupSelectedText'],{
    terms:[term],settingsOpen:false,editorOpen:false,importOpen:false,capturingShortcut:null,
    categoryFilter:'Training',statusFilter:'candidate',scopeFilter:'private',
    showSearchWindow:async()=>{},document:{querySelector:()=>null},
  });
  await h.lookupSelectedText({text:'RAG'});
  assert.equal(h.selectedTerm.id,'rag');
  assert.equal(h.categoryFilter,''); assert.equal(h.statusFilter,''); assert.equal(h.scopeFilter,'all');
  h.importOpen=true; await h.lookupSelectedText({text:'other'});
  assert.equal(h.searchText,'RAG');
});

function desktopWrites(fail=false) {
  const commits=[];
  const h=harness(desktop,['normalize','firestoreValue','firestoreFields','saveEditor','canEdit','deleteTerm'],{
    editingTerm:{id:'term',createdBy:'alice',visibility:'public'},
    publicTerms:[{id:'term',createdBy:'alice'}],memberTerms:[{id:'term',createdBy:'alice'}],
    FormData:class { constructor(values){this.values=values;} get(key){return this.values[key];} },
    restSetDocument(){throw Error('unexpected non-atomic write');},
    restDeleteDocument(){throw Error('unexpected non-atomic delete');},
    restCommit:async writes=>{commits.push(writes);if(fail)throw Error('network unavailable');},
    editorOpen:true,
  });
  return {h,commits};
}
const form = {term_en:'New term',term_zh:'新詞',definition:'Definition',simple_explanation:'Explanation',visibility:'private'};
test('desktop visibility changes commit owner copy and removals together',async()=>{
  const {h,commits}=desktopWrites();
  await h.saveEditor({preventDefault(){},currentTarget:form});
  assert.equal(commits.length,1);assert.equal(commits[0].length,3);
  assert.equal(commits[0][0].update.fields.visibility.stringValue,'private');
  assert.equal(commits[0].filter(w=>w.delete).length,2);
  assert.equal(h.editorOpen,false);
});
test('desktop failed save keeps editor open; deletion is one commit',async()=>{
  const {h,commits}=desktopWrites(true);
  await h.saveEditor({preventDefault(){},currentTarget:form});
  assert.equal(h.editorOpen,true);
  const ok=desktopWrites();await ok.h.deleteTerm({id:'term',createdBy:'alice'});
  assert.equal(ok.commits.length,1);assert.equal(ok.commits[0].length,3);
  assert.ok(ok.commits[0].every(w=>w.delete));
});

function webWrites(fail=false) {
  const commits=[];
  const h=harness(web,['syncPersonalTerm','deletePersonalTerm'],{
    db:{},doc:(_, ...path)=>path.join('/'), serverTimestamp:()=> 'timestamp',
    publicTerms:[{id:'term',createdBy:'alice'}],memberTerms:[{id:'term',createdBy:'alice'}],
    writeBatch:()=>{const writes=[];return {
      set(ref,data){writes.push({ref,data});},delete(ref){writes.push({delete:ref});},
      async commit(){commits.push(writes);if(fail)throw Error('permission denied');},
    };},
  });
  return {h,commits};
}
test('web visibility changes and deletes use atomic batches',async()=>{
  const {h,commits}=webWrites();
  await h.syncPersonalTerm('term',form,{createdBy:'alice'});
  assert.equal(commits.length,1);assert.equal(commits[0].length,3);
  await h.deletePersonalTerm({id:'term',createdBy:'alice'});
  assert.equal(commits.length,2);assert.equal(commits[1].length,3);
});
test('web permission failures propagate; other owners cannot be edited',async()=>{
  const {h,commits}=webWrites(true);
  await assert.rejects(h.syncPersonalTerm('term',form,{createdBy:'alice'}),/permission/);
  await assert.rejects(h.syncPersonalTerm('term',form,{createdBy:'bob'}),/只能/);
  assert.equal(commits.length,1);
});

test('desktop partial import retry writes only unfinished rows',async()=>{
  const rows=Array.from({length:201},(_,i)=>({kind:'new',term:{term_en:`Term ${i}`,visibility:'private'}}));
  const sizes=[];
  const h=harness(desktop,['firestoreValue','firestoreFields','runImport'],{
    importRows:rows,importBusy:false,importVisibility:'',
    restCommit:async writes=>{sizes.push(writes.length);if(sizes.length===2)throw Error('offline');},
  });
  await h.runImport(); assert.equal(rows.filter(r=>r.kind==='new').length,1);
  await h.runImport(); assert.deepEqual(sizes,[200,1,1]);
});
test('web partial import retry writes only unfinished rows',async()=>{
  const rows=Array.from({length:201},(_,i)=>({kind:'new',term:{term_en:`Term ${i}`,visibility:'private'}}));
  const sizes=[];
  const h=harness(web,['executeBatchImport'],{
    pendingImportRows:rows,db:{},personalTermsCollection:()=>({}),
    doc:()=>({id:randomUUID()}),serverTimestamp:()=>0,
    els:{executeImportBtn:{},importVisibility:{value:''},importDialog:{close(){}}},
    renderImportPreview(){},resetImportDialog(){},
    writeBatch:()=>{let size=0;return {set(){size++;},async commit(){sizes.push(size);if(sizes.length===2)throw Error('offline');}};},
  });
  await h.executeBatchImport();assert.equal(rows.filter(r=>r.kind==='new').length,1);
  await h.executeBatchImport();assert.deepEqual(sizes,[200,1,1]);
});

test('web malformed import items are marked invalid instead of crashing preview',()=>{
  const h=harness(web,['toBool','importVisibility','normalizeImportTerm','validateImportTerm','analyzeBatchJson'],{
    els:{batchJson:{value:'[null,123,"bad"]'}},renderImportPreview(){},
  });
  h.analyzeBatchJson();
  assert.equal(h.pendingImportRows.length,3);
  assert.ok(h.pendingImportRows.every(row=>row.kind==='invalid'));
});

test('late private sync response cannot restore terms after logout',async()=>{
  let resolve; const pending=new Promise(r=>{resolve=r;});
  const h=harness(desktop,['loadTerms'],{
    restListDocuments:async()=>[],listPrivateTerms:()=>pending,
    mergeTerms(){this.terms=[...this.publicTerms,...this.privateTerms,...this.memberTerms];},
  });
  const task=h.loadTerms();await new Promise(setImmediate);
  h.currentUser=null;h.privateTerms=[];h.memberTerms=[];h.terms=[];
  resolve([{id:'private',createdBy:'alice'}]);await task;
  assert.equal(h.terms.length,0);assert.equal(h.privateTerms.length,0);
});

test('failed old account sync cannot clear a newer account dictionary',async()=>{
  for (const phase of ['private','members']) {
    let reject;
    const pending=new Promise((_,r)=>{reject=r;});
    const h=harness(desktop,['loadTerms'],{
      restListDocuments:async collection=>collection==='member_research_dictionary'?pending:[],
      listPrivateTerms:()=>phase==='private'?pending:Promise.resolve([]),
      ensureFirebaseIdToken:async()=> 'token',
      mergeTerms(){throw Error('old load must not merge');},
    });
    const task=h.loadTerms();await new Promise(setImmediate);
    h.currentUser={uid:'bob'};h.loadGeneration++;
    h.privateTerms=[{id:'bob-private'}];h.memberTerms=[{id:'new-member'}];
    reject(Error('offline'));await task;
    assert.deepEqual(ids(h.privateTerms),['bob-private']);
    assert.deepEqual(ids(h.memberTerms),['new-member']);
  }
});

test('hotkeys are available before session or network loading completes',async()=>{
  const order=[];
  let startup;
  const h=vm.createContext({
    window:{addEventListener:(_,fn)=>{startup=fn;},setTimeout(){},setInterval(){}},
    listen:async()=>{},getVersion:async()=> 'test',render(){},shortcutConfig:{},console,
    registerHotkeys:async()=>{order.push('shortcuts');},
    restoreDesktopSession:async()=>{order.push('session');},loadTerms:async()=>{order.push('terms');},
  });
  vm.runInContext(desktop.slice(desktop.indexOf("window.addEventListener('DOMContentLoaded'")),h);
  await startup();assert.deepEqual(order,['shortcuts','session','terms']);
});

test('refresh arriving after logout or account switch cannot reinstate old login',async()=>{
  let resolve;
  const response=new Promise(r=>{resolve=r;});
  const h=harness(desktop,['ensureFirebaseIdToken'],{
    authSession:{uid:'alice',refreshToken:'old',expiresAtMs:0},authGeneration:1,
    AUTH_REFRESH_URL:'https://example.test/refresh',fetch:()=>response,
    persistAuthSession(){throw Error('stale session must not be persisted');},
  });
  const pending=h.ensureFirebaseIdToken();
  h.authSession={uid:'bob',refreshToken:'new'};h.authGeneration++;
  resolve({ok:true,json:async()=>({id_token:'alice-token'})});
  await assert.rejects(pending,/登入狀態已變更/);
  assert.equal(h.authSession.uid,'bob');
});

test('cancelled desktop login cannot persist a credential exchange arriving late',async()=>{
  let resolve;let active=true;
  const response=new Promise(r=>{resolve=r;});
  const h=harness(desktop,['exchangeGoogleCredentialForFirebase'],{
    AUTH_SIGNIN_URL:'https://example.test/signin',fetch:()=>response,
    persistAuthSession(){throw Error('cancelled login must not be persisted');},
  });
  const pending=h.exchangeGoogleCredentialForFirebase({googleIdToken:'fake'},()=>active);
  active=false;resolve({ok:true,json:async()=>({idToken:'fake',refreshToken:'fake',localId:'alice'})});
  await assert.rejects(pending,/登入已取消/);
});
