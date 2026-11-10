/* 業務研究室 — no third-party scripts, no external API calls. All data is stored in this browser. */
'use strict';
// iPhone/iPad Safari: prevent accidental pinch-zoom while preserving one-finger
// scrolling, taps, focusing inputs, and native text selection.
// A user's system Accessibility Zoom feature is not affected.
const isIOSDevice = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOSDevice) {
  document.addEventListener('gesturestart', event => event.preventDefault(), {passive:false});
  document.addEventListener('gesturechange', event => event.preventDefault(), {passive:false});
  document.addEventListener('touchmove', event => {
    if (event.touches.length > 1 && event.cancelable) event.preventDefault();
  }, {passive:false});
}
const DB_NAME='gyomu-research-local-v1';
const STORAGE_KEY='gyomu-research-fallback-v1';
const RATING_FIELDS=[['initiative','主体性'],['observation','観察力'],['planning','準備・段取り'],['communication','コミュニケーション'],['learning','学習・改善']];
const NOTE_TYPES={insight:'気づき',success:'成功体験',failure:'失敗体験',decision:'判断記録',learning:'学習記録',improvement:'改善活動'};
const NOTE_STATUS={open:'未着手・未調査',working:'調査中・進行中',waiting:'結果待ち・保留',closed:'確認済み・完了'};
const AVAIL={ready:'実行可能',prep:'準備が必要',blocked:'条件待ち'};
const TASK_STATUS={todo:'未着手',doing:'進行中',hold:'保留',done:'完了'};
const EQUIPMENT_CATEGORIES=['服装','持ち物','その他'];
const WEATHER_OPTIONS=[['','選択してください'],['sunny','晴れ'],['cloudy','くもり'],['rain','雨'],['snow','雪'],['blizzard','吹雪'],['other','その他']];
const CROWD_OPTIONS=[['','選択してください'],['empty','空いていた'],['normal','普通'],['busy','混んでいた'],['packed','非常に混雑']];
const BUFFER_OPTIONS=[['','選択してください'],['enough','十分余裕があった'],['some','少し余裕があった'],['tight','ぎりぎりだった'],['late','遅れそう・遅れた']];
const TRANSPORT_OPTIONS=[['','選択してください'],['train','電車・地下鉄'],['bus','バス'],['car','車'],['walk','徒歩'],['bike','自転車'],['other','その他']];
const optionLabel=(options,key)=>options.find(x=>x[0]===key)?.[1]||'未記録';

const $=sel=>document.querySelector(sel);
const icon=(name,cls='')=>`<svg aria-hidden="true" class="icon ${cls}"><use href="#i-${name}"></use></svg>`;
const h=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const nl=value=>h(value).replace(/\n/g,'<br>');
const uid=()=>{if(crypto.randomUUID)return crypto.randomUUID();return 'id-'+Date.now()+'-'+Math.random().toString(36).slice(2)};
const dstr=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
function parseDay(s){const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12)}
function stepDay(s,delta){const d=parseDay(s);d.setDate(d.getDate()+delta);return dstr(d)}
function niceDay(s,weekday=true){if(!s)return '日付未設定';const d=parseDay(s);return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日${weekday?'（'+'日月火水木金土'[d.getDay()]+'）':''}`}
const today=()=>dstr();
const shortDate=s=>{if(!s)return '';const d=parseDay(s);return `${d.getMonth()+1}/${d.getDate()}`};
const isDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&dstr(parseDay(s))===s;
const dueText=(s,label='完了予定')=>s&&isDate(s)?`${label}：${shortDate(s)}`:'完了予定日未設定';
const dueTag=(s,label='完了予定')=>s&&isDate(s)?`<span class="date-chip">${icon('calendar','icon-mini')} ${h(label)} ${h(shortDate(s))}</span>`:'';
function goalFinishedAt(id){const leaves=goalTasks(id).filter(isLeaf);if(!leaves.length||!leaves.every(t=>t.status==='done'&&t.completedAt))return null;return leaves.map(t=>t.completedAt).sort().at(-1)}

const isoNow=()=>new Date().toISOString();
const defaultDay=()=>({summary:'',achievements:'',challenges:'',notices:'',tomorrow:'',praise:'',ratings:{},updatedAt:null});
const newState=()=>({version:1,groups:[],goals:[],tasks:[],days:{},notes:[],commute:{equipment:[],contacts:[],entries:{}},createdAt:isoNow()});
function ensureCommuteState(){
 if(!data.commute||typeof data.commute!=='object')data.commute={};
 if(!Array.isArray(data.commute.equipment))data.commute.equipment=[];
 if(!Array.isArray(data.commute.contacts))data.commute.contacts=[];
 if(!data.commute.entries||typeof data.commute.entries!=='object'||Array.isArray(data.commute.entries))data.commute.entries={};
 return data.commute;
}

let data=newState();
let db=null,storeMethod='pending',saveQueue=Promise.resolve(),saveTimer=null;
let ui={page:'home',day:today(),activeGroup:'all',activeGoal:null,todoView:'tree',calendarMonth:today().slice(0,7),calendarSelected:today(),researchType:'all',researchQuery:'',collapsed:new Set(),execFilter:'ready',reflectionPeriod:'week',commuteView:'check',commuteDay:today(),commuteChecked:new Set(),modal:null};
let pendingToast=null;
const APP_VERSION='1.4.3';
let pwa={registration:null,ready:false,updateAvailable:false,error:'',updating:false};
const isInstalledApp=()=>window.matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
function showPwaInfo(){
  const badge=$('#pwa-connect-pill');
  if(badge){badge.textContent=navigator.onLine?'オンライン':'オフライン';badge.classList.toggle('offline',!navigator.onLine)}
  const state=$('#pwa-current-status');
  if(state)state.textContent=!('serviceWorker' in navigator)?'このブラウザは非対応':!window.isSecureContext?'HTTPS接続で利用してください':pwa.error?'オフライン準備で問題が発生':pwa.ready?'オフライン起動の準備完了':'準備中（初回はネット接続が必要）';
  const install=$('#pwa-installed-status');
  if(install)install.textContent=isInstalledApp()?'ホーム画面アプリとして起動中':'ブラウザで起動中';
  const network=$('#pwa-network-status');
  if(network)network.textContent=navigator.onLine?'接続あり':'接続なし（端末の判定）';
  const update=$('#pwa-apply-update');
  if(update)update.hidden=!pwa.updateAvailable;
  const stateText=$('#pwa-update-text');
  if(stateText)stateText.textContent=pwa.updateAvailable?'新しい版があります。入力内容を保存してから更新できます。':'更新があれば、この欄から確認できます。';
}
function handleNewWorker(reg){
  if(reg.waiting && navigator.serviceWorker.controller){pwa.updateAvailable=true;showPwaInfo();return}
  if(reg.installing){reg.installing.addEventListener('statechange',()=>{
    if(reg.waiting&&navigator.serviceWorker.controller){pwa.updateAvailable=true;showPwaInfo()}
  })}
}
async function setupPwa(){
  if(!('serviceWorker' in navigator)||!window.isSecureContext){showPwaInfo();return}
  try{
    const reg=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
    pwa.registration=reg;
    handleNewWorker(reg);
    reg.addEventListener('updatefound',()=>handleNewWorker(reg));
    await navigator.serviceWorker.ready;
    pwa.ready=Boolean(navigator.serviceWorker.controller || reg.active);
    showPwaInfo();
    // A returning user sees updated files after a deliberate app restart.
    if(navigator.onLine)reg.update().catch(()=>{});
  }catch(error){pwa.error=String(error);console.warn('Offline setup failed:',error);showPwaInfo()}
}
async function checkAppUpdate(){
  if(!pwa.registration){toast('更新の確認にはHTTPS環境とネット接続が必要です');return}
  if(!navigator.onLine){toast('ネット接続時に更新を確認してください');return}
  try{await pwa.registration.update();handleNewWorker(pwa.registration);
   toast(pwa.updateAvailable?'新しい版があります。「更新を適用」を押してください':'更新を確認しました');
  }catch(error){toast('更新を確認できませんでした。ネット接続をご確認ください')}
}
async function applyAppUpdate(){
  if(!pwa.registration?.waiting){toast('適用できる更新はありません');return}
  await flushSave();
  pwa.updating=true;
  pwa.registration.waiting.postMessage({type:'SKIP_WAITING'});
}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(pendingToast);pendingToast=setTimeout(()=>el.classList.remove('visible'),2700)}
function dayData(date){if(!data.days[date])data.days[date]=defaultDay();return data.days[date]}
function validateState(o){return o&&typeof o==='object'&&o.version===1&&Array.isArray(o.groups)&&Array.isArray(o.goals)&&Array.isArray(o.tasks)&&o.days&&typeof o.days==='object'&&Array.isArray(o.notes)}
function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('records'))req.result.createObjectStore('records')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function idbGet(key){return new Promise((resolve,reject)=>{const tx=db.transaction('records','readonly');const req=tx.objectStore('records').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function idbPut(key,value){return new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
async function initialize(){
  try{db=await openDb();const existing=await idbGet('app');storeMethod='IndexedDB';if(validateState(existing))data=existing}
  catch(e){console.warn('IndexedDB unavailable:',e);try{const saved=localStorage.getItem(STORAGE_KEY);if(saved){const existing=JSON.parse(saved);if(validateState(existing))data=existing}localStorage.setItem('__gyomu_test','1');localStorage.removeItem('__gyomu_test');storeMethod='localStorage'}catch(error){storeMethod='memory'}}
  ensureCommuteState();
  render();
  if(storeMethod==='memory')toast('この環境では保存できません。別のブラウザ環境で開いてください。');
  setupPwa();
}
function persist(){const copy=JSON.parse(JSON.stringify(data));saveQueue=saveQueue.catch(()=>{}).then(async()=>{try{if(storeMethod==='IndexedDB')await idbPut('app',copy);else if(storeMethod==='localStorage')localStorage.setItem(STORAGE_KEY,JSON.stringify(copy))}catch(error){console.error(error);storeMethod='memory';toast('保存に失敗しました。容量やブラウザの設定を確認してください。')}});return saveQueue}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>persist(),400)}
async function flushSave(){if(saveTimer){clearTimeout(saveTimer);saveTimer=null;await persist()}else await saveQueue}
function sectionHead(title,ico,action='',label='すべて見る'){return `<div class="card-head"><span class="card-head-title">${icon(ico)}${h(title)}</span>${action?`<button class="card-action" data-action="${h(action)}">${h(label)} ›</button>`:''}</div>`}
function empty(ico,title,sub,button=''){return `<div class="empty-state">${icon(ico)}<h3>${h(title)}</h3><p>${h(sub)}</p>${button}</div>`}
function groupName(id){return data.groups.find(g=>g.id===id)?.name||'未分類'}
function goalById(id){return data.goals.find(g=>g.id===id)}
function taskById(id){return data.tasks.find(t=>t.id===id)}
function goalTasks(id){return data.tasks.filter(t=>t.goalId===id)}
function children(parent,goalId){return data.tasks.filter(t=>t.goalId===goalId&&t.parentId===parent).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))}
function isLeaf(t){return !data.tasks.some(x=>x.parentId===t.id)}
function goalProgress(goalId){const leaves=goalTasks(goalId).filter(isLeaf),done=leaves.filter(t=>t.status==='done').length;return {done,total:leaves.length,pct:leaves.length?Math.round(done/leaves.length*100):0}}
function taskPercent(t){const all=goalTasks(t.goalId);const underneath=(root)=>all.filter(x=>x.parentId===root);const leaves=[];function visit(root){const c=underneath(root);if(!c.length){const x=taskById(root);if(x)leaves.push(x);return}c.forEach(x=>visit(x.id))}visit(t.id);return leaves.length?Math.round(leaves.filter(x=>x.status==='done').length/leaves.length*100):0}
function descendantIds(id){const found=[];const visit=i=>{found.push(i);data.tasks.filter(t=>t.parentId===i).forEach(x=>visit(x.id))};visit(id);return found}
function syncParentStatuses(goalId){function update(t){const kids=children(t.id,t.goalId);kids.forEach(update);if(kids.length){if(kids.every(k=>k.status==='done'))t.status='done';else if(kids.some(k=>k.status==='done'||k.status==='doing'))t.status='doing';else t.status='todo';t.completedAt=t.status==='done'?(t.completedAt||isoNow()):null}}children(null,goalId).forEach(update)}
function setTaskDone(id,done){const target=taskById(id);if(!target)return;descendantIds(id).forEach(tid=>{const t=taskById(tid);t.status=done?'done':'todo';t.completedAt=done?isoNow():null});syncParentStatuses(target.goalId);persist();render()}
function isTodayTask(t){return isLeaf(t)&&t.plannedDate===today()&&t.status!=='done'}
function homeTodoItems(){return data.tasks.filter(t=>isLeaf(t)&&t.plannedDate===today()).sort((a,b)=>Number(a.status==='done')-Number(b.status==='done')||(a.dueDate||'9999').localeCompare(b.dueDate||'9999'))}
function render(){try{const root=$('#app');const pages={home:renderHome,daily:renderDaily,todos:renderTodos,commute:renderCommute,research:renderResearch,reflection:renderReflection,settings:renderSettings};root.innerHTML=(pages[ui.page]||pages.home)();document.querySelectorAll('.nav-link').forEach(n=>n.classList.toggle('active',n.dataset.page===ui.page));if(ui.modal)renderModal();showPwaInfo();}catch(error){console.error(error);$('#app').innerHTML=`<div class="error-box">画面の表示中に問題が発生しました。ページを再読み込みしてください。<br>${h(error.message)}</div>`}}
function changePage(page){flushSave();if(ui.page!==page&&ui.page==='commute'||page==='commute'&&ui.page!==page)ui.commuteChecked.clear();ui.page=page;ui.modal=null;$('#modal-root').innerHTML='';window.scrollTo({top:0,behavior:'instant'});render()}
function header(title,description,kicker='BUSINESS RESEARCH',buttons=''){return `<div class="page-header"><div><div class="eyebrow">${h(kicker)}</div><h2 class="page-title">${h(title)}</h2><p class="page-desc">${h(description)}</p></div>${buttons?`<div class="page-tools">${buttons}</div>`:''}</div>`}
function dayStrip(date){return `<div class="date-strip"><button data-action="day-step" data-step="-1" aria-label="前日へ">‹</button><strong>${icon('calendar')}${niceDay(date)}</strong><div><button class="date-today" data-action="day-today">今日</button><button data-action="day-step" data-step="1" aria-label="翌日へ">›</button></div></div>`}
function renderHome(){const d=dayData(stepDay(today(),-1)),tasks=homeTodoItems(),active=data.goals.filter(g=>!g.archivedAt).slice(0,5);let percentActive=active.map(g=>({...g,progress:goalProgress(g.id)}));
return `${header('今日の研究記録','小さな気づきが、仕事の質を変えていきます。','THE DAILY JOURNAL',`<button class="outline-btn small-btn" data-action="navigate" data-page="settings">${icon('shield','icon-mini')} 保存設定</button>`)}
${dayStrip(today())}
<div class="hero-grid"><div class="stack">
<section class="card">${sectionHead('今日の行動目標','target','navigate-daily','前日の記録を編集')}<div class="goal-strip">${d.tomorrow?`<p>${nl(d.tomorrow)}</p>`:`<div class="empty-note">今日の行動目標はまだありません。前日の業務記録で設定しましょう。</div>`}</div></section>
<section class="card">${sectionHead('今日取り組むTODO（'+tasks.length+'件）','check','navigate-exec','実行リスト')}
<div class="panel-body">${tasks.length?tasks.slice(0,6).map(t=>`<div class="daily-todo"><button class="checkbox ${t.status==='done'?'checked':''}" data-action="toggle-task" data-id="${h(t.id)}" aria-label="${t.status==='done'?'未完了にする':'完了にする'}">${icon('check')}</button><div class="daily-todo-text"><strong class="${t.status==='done'?'done-text':''}">${h(t.title)}</strong><small>${h(goalById(t.goalId)?.title||'')} · ${h(AVAIL[t.availability]||'実行可能')}</small></div><button class="text-btn" data-action="focus-goal" data-id="${h(t.goalId)}">${icon('tree','icon-mini')}</button></div>`).join('')+(tasks.length>6?`<button class="text-btn" data-action="navigate-exec">他 ${tasks.length-6} 件を見る →</button>`:''):`<div class="empty-note">今日のTODOは未設定です。実行リストから追加できます。</div>`}<button class="outline-btn small-btn w100 mt10" data-action="navigate-exec">${icon('plus','icon-mini')} 実行するTODOを選ぶ</button></div></section>
<button class="primary-btn big" data-action="navigate" data-page="daily">${icon('plus')} 記録する</button>
<div class="shortcuts"><button class="shortcut" data-action="navigate" data-page="daily">${icon('note')}<span><strong>業務記録</strong><small>今日の業務・気づき</small></span></button><button class="shortcut" data-action="navigate" data-page="todos">${icon('tree')}<span><strong>TODOツリー</strong><small>目標から行動を設計</small></span></button><button class="shortcut" data-action="navigate" data-page="research">${icon('book')}<span><strong>研究ノート</strong><small>学び・判断・改善</small></span></button><button class="shortcut" data-action="navigate" data-page="reflection">${icon('chart')}<span><strong>振り返り</strong><small>評価・成長・分析</small></span></button><button class="shortcut commute-shortcut" data-action="navigate" data-page="commute">${icon('train')}<span><strong>通勤記録</strong><small>出発チェック・通勤ログ・緊急連絡先</small></span></button></div></div>
<div class="stack"><section class="card">${sectionHead('進行中の目標（'+data.goals.filter(g=>!g.archivedAt).length+'件）','target','navigate-todos','すべて見る')}<div class="panel-body">${percentActive.length?percentActive.map(({id,title,progress})=>`<div class="progress-row"><button class="progress-name" data-action="focus-goal" data-id="${h(id)}">${icon('target','icon-mini')}<span>${h(title)}</span></button><div class="progress-bar"><span class="progress-fill" style="width:${progress.pct}%"></span></div><span class="progress-value">${progress.pct}%</span></div>`).join(''):`<div class="empty-note">まだ目標がありません。TODOツリーから作成しましょう。</div><button class="outline-btn small-btn" data-action="new-goal">${icon('plus','icon-mini')} 目標をつくる</button>`}</div></section>
<section class="card">${sectionHead('最近の研究メモ','book','navigate-research','一覧へ')}<div class="panel-body">${data.notes.slice().sort((a,b)=>(b.date+b.updatedAt).localeCompare(a.date+a.updatedAt)).slice(0,3).map(n=>`<div class="daily-todo"><span class="tag">${h(NOTE_TYPES[n.kind])}</span><button class="text-btn" style="text-align:left;flex:1" data-action="edit-note" data-id="${h(n.id)}">${h(n.title)}</button><small class="minilabel">${shortDate(n.date)}</small></div>`).join('')||`<div class="empty-note">気づきや判断を残すと、ここに表示されます。</div>`}<button class="outline-btn small-btn w100 mt10" data-action="new-note">${icon('plus','icon-mini')} 研究メモを追加</button></div></section>
<div class="notice-bar">${icon('shield','icon-mini')}<span>記録はこの端末のブラウザ内に保存されます。重要な記録は設定から暗号化バックアップしてください。外部AIへのコピー時には機密情報を確認しましょう。</span></div></div></div>`}
function renderDaily(){const d=dayData(ui.day),prev=dayData(stepDay(ui.day,-1));const doneToday=data.tasks.filter(t=>t.completedAt&&dstr(new Date(t.completedAt))===ui.day&&isLeaf(t));return `${header('一日の業務記録','仕事の事実、気づき、次の一歩を記録します。','DAILY LOG',`<button class="outline-btn small-btn" data-action="open-prompt" data-type="daily">${icon('copy','icon-mini')} AI用文章</button>`)}${dayStrip(ui.day)}
<div class="grid2"><div class="stack"><section class="card"><div class="soft-head">${icon('note','icon-mini')} 今日の出来事 <span class="save-status" id="autosave-label">入力内容は自動保存されます</span></div><div class="form-section daily-form">
<div class="field"><label for="daily-summary">今日取り組んだ業務</label><textarea id="daily-summary" data-daily="summary" placeholder="取り組んだ業務を、箇条書きでも構いません。">${h(d.summary)}</textarea></div>
<div class="field"><label for="daily-achievements">今日達成したこと・成功体験</label><textarea id="daily-achievements" data-daily="achievements" placeholder="うまくできたこと、進歩したことを書きます。">${h(d.achievements)}</textarea></div>
<div class="field"><label for="daily-challenges">課題・失敗体験・未完了事項</label><textarea id="daily-challenges" data-daily="challenges" placeholder="困ったことや、次回に活かしたいこと。">${h(d.challenges)}</textarea></div>
<div class="field"><label for="daily-notices">今日の気づき・疑問</label><textarea id="daily-notices" data-daily="notices" placeholder="『なぜだろう？』と感じたことを一つ。">${h(d.notices)}</textarea></div>
${doneToday.length?`<div class="tip">${icon('check','icon-mini')} 今日完了したTODO（${doneToday.length}件）：${h(doneToday.map(t=>t.title).join('、'))}</div>`:''}
</div></section>
<section class="card"><div class="soft-head">${icon('target','icon-mini')} 今日と明日の行動</div><div class="form-section daily-form">
<div class="field"><label>昨日決めた行動目標</label><div class="tip preline">${h(prev.tomorrow||'昨日の目標はまだ登録されていません。')}</div></div>
<div class="field"><label for="daily-tomorrow">明日につなげたい行動目標</label><textarea id="daily-tomorrow" data-daily="tomorrow" placeholder="できれば1～3件、具体的な行動を。">${h(d.tomorrow)}</textarea><small>翌日のホーム画面に表示します。</small></div></div></section></div>
<div class="stack"><section class="card"><div class="soft-head">${icon('chart','icon-mini')} 一日の自己評価</div><div class="form-section"><p class="help-copy">成果の大小ではなく、自分でコントロールできた行動を評価します。未入力でも構いません。</p><div class="ratings-grid">${RATING_FIELDS.map(([key,label])=>`<div class="rating-row"><span>${h(label)}</span><div class="rating-buttons">${[1,2,3,4,5].map(n=>`<button data-action="rate" data-key="${key}" data-value="${n}" class="${d.ratings[key]===n?'selected':''}" aria-label="${h(label)} ${n}点" aria-pressed="${d.ratings[key]===n}">${n}</button>`).join('')}</div></div>`).join('')}</div>
<div class="field mt15"><label for="daily-praise">今日の自分を褒めるなら？</label><textarea id="daily-praise" data-daily="praise" placeholder="小さな一歩も、きちんと認めましょう。">${h(d.praise)}</textarea></div></div></section>
<section class="card"><div class="soft-head">${icon('book','icon-mini')} 研究ノートに残す</div><div class="panel-body"><p class="help-copy">成功・失敗・気づきを詳しく分析したいときは、研究メモとして独立して残せます。</p><div class="pill-actions"><button class="outline-btn small-btn" data-action="new-note" data-kind="insight">＋ 気づき</button><button class="outline-btn small-btn" data-action="new-note" data-kind="success">＋ 成功体験</button><button class="outline-btn small-btn" data-action="new-note" data-kind="failure">＋ 失敗体験</button></div></div></section>
<div class="notice-bar">${icon('shield','icon-mini')}<span>顧客名、担当者名、社内資料などの機密情報は、個人端末への保存が認められるか会社の規程を確認してください。</span></div>
</div></div>`}
function renderTodos(){
 const groupOptions=[{id:'all',name:'すべて'},...data.groups,{id:'ungrouped',name:'未分類'}];
 const goals=data.goals.filter(g=>ui.activeGroup==='all'||(ui.activeGroup==='ungrouped'?!g.groupId:g.groupId===ui.activeGroup));
 if(!goals.some(g=>g.id===ui.activeGoal))ui.activeGoal=goals[0]?.id||null;
 return `${header('TODOツリー','目標から逆算し、何度でも実行できる行動を設計します。','ACTION DESIGN',`<button class="outline-btn small-btn" data-action="new-group">${icon('folder','icon-mini')} グループ</button><button class="primary-btn small-btn" data-action="new-goal">${icon('plus','icon-mini')} 目標を作成</button>`)}
 <div class="goal-toolbar"><div class="toolbar-left">${groupOptions.map(g=>`<span class="group-control"><button data-action="filter-group" data-id="${h(g.id)}" class="group-pill ${ui.activeGroup===g.id?'active':''}">${h(g.name)}${g.dueDate&&isDate(g.dueDate)?` <span class="group-date">${h(shortDate(g.dueDate))}</span>`:''}</button>${g.id!=='all'&&g.id!=='ungrouped'?`<button class="group-edit" data-action="edit-group" data-id="${h(g.id)}" aria-label="${h(g.name)}を編集">✎</button>`:''}</span>`).join('')}</div></div>
 ${data.goals.length?`<div class="goal-tiles">${goals.map(g=>{const p=goalProgress(g.id);return `<div class="goal-tile ${g.id===ui.activeGoal?'selected':''}" data-action="focus-goal" data-id="${h(g.id)}"><div class="goal-tile-title">${icon('target')}<span>${h(g.title)}</span>${g.archivedAt?'<span class="tag gold">達成保存済</span>':''}</div><div class="goal-tile-desc">${h(groupName(g.groupId))} · ${h(g.description||'目標に向かって少しずつ進みましょう。')}</div><div class="goal-tile-due">${dueTag(g.dueDate,'目標の完了予定')}${goalFinishedAt(g.id)?`<span class="date-chip finished-chip">完了実績 ${h(shortDate(dstr(new Date(goalFinishedAt(g.id)))))}</span>`:''}</div><div class="goal-tile-footer"><div class="progress-bar"><span class="progress-fill" style="width:${p.pct}%"></span></div><strong>${p.pct}%</strong></div></div>`}).join('')}</div>`:empty('target','目標をつくりましょう','一つの目標から、実行できる行動を枝分かれさせます。',`<button class="primary-btn" data-action="new-goal">${icon('plus','icon-mini')} 最初の目標を作る</button>`)}
 ${goals.length?`<div class="tabs" role="tablist" aria-label="TODOの表示方法"><button class="tab ${ui.todoView==='tree'?'active':''}" data-action="todo-tab" data-view="tree" role="tab" aria-selected="${ui.todoView==='tree'}">${icon('tree','icon-mini')} ツリー表示</button><button class="tab ${ui.todoView==='list'?'active':''}" data-action="todo-tab" data-view="list" role="tab" aria-selected="${ui.todoView==='list'}">${icon('check','icon-mini')} 実行リスト</button><button class="tab ${ui.todoView==='calendar'?'active':''}" data-action="todo-tab" data-view="calendar" role="tab" aria-selected="${ui.todoView==='calendar'}">${icon('calendar','icon-mini')} カレンダー</button></div>${ui.todoView==='tree'?renderTree():ui.todoView==='list'?renderExecute():renderCalendar()}`:data.goals.length?`<div class="empty-state">このグループには目標がありません。<button class="outline-btn small-btn" data-action="new-goal">＋ 追加する</button></div>`:''}`
}
function renderTree(){const g=goalById(ui.activeGoal);if(!g)return '';const p=goalProgress(g.id),roots=children(null,g.id),group=data.groups.find(x=>x.id===g.groupId);
return `<section><div class="tree-goal-head"><div class="goal-head-row"><strong>${icon('target')} ${h(g.title)}</strong><span class="tag gold">進捗 ${p.pct}%</span></div><p>${h(g.description||'目標達成のための行動を、一歩ずつ分解していきましょう。')}</p><div class="goal-dates">${dueTag(g.dueDate,'目標の完了予定')}${group?dueTag(group.dueDate,'グループの完了予定'):''}${goalFinishedAt(g.id)?`<span class="date-chip finished-chip">実際の完了日 ${h(niceDay(dstr(new Date(goalFinishedAt(g.id))),false))}</span>`:''}</div>${g.doneCriteria?`<p>完了条件：${h(g.doneCriteria)}</p>`:''}<div class="pill-actions mt10"><button class="ghost-btn" data-action="edit-goal" data-id="${h(g.id)}">目標を編集</button><button class="ghost-btn" data-action="duplicate-goal" data-id="${h(g.id)}">${icon('copy','icon-mini')} ツリー複製</button><button class="ghost-btn" data-action="archive-goal" data-id="${h(g.id)}">${g.archivedAt?'保存解除':'研究成果として保存'}</button></div></div>
<div class="tree-wrap">${roots.length?`<ul class="tree-root">${roots.map(t=>treeNode(t)).join('')}</ul>`:empty('tree','まだ枝がありません','目標の一歩手前にある行動から考えてみましょう。')}
<button class="tree-add" data-action="new-task" data-goal="${h(g.id)}">${icon('plus','icon-mini')} 子TODOを追加（この目標に直接追加）</button></div><p class="help-copy mt10">✓ を押すと完了にできます。親TODOを完了にすると配下の子TODOも完了します。完了予定日は各TODOをタップして設定できます。</p></section>`
}
function treeNode(t){const kids=children(t.id,t.goalId),hasKids=kids.length>0,collapsed=ui.collapsed.has(t.id),p=taskPercent(t);return `<li class="tree-item"><div class="tree-node ${hasKids?'parent':''}">
${hasKids?`<button class="tree-iconbtn collapse-btn ${collapsed?'is-collapsed':''}" data-action="collapse" data-id="${h(t.id)}" aria-label="枝の開閉">⌄</button>`:`<span style="width:24px;flex-shrink:0"></span>`}
<button class="checkbox ${t.status==='done'?'checked':''}" data-action="toggle-task" data-id="${h(t.id)}" aria-label="${t.status==='done'?'未完了に戻す':'完了する'}">${icon('check')}</button>
<button class="tree-title ${t.status==='done'?'done':''}" data-action="edit-task" data-id="${h(t.id)}"><span class="tree-title-main">${h(t.title)} ${t.plannedDate===today()?' <span class="tag green">今日</span>':''}</span>${t.dueDate&&isDate(t.dueDate)?`<span class="tree-due">${icon('calendar','icon-mini')} 完了予定 ${h(shortDate(t.dueDate))}</span>`:''}${t.status==='done'&&t.completedAt?`<span class="tree-due done-date">実際の完了 ${h(shortDate(dstr(new Date(t.completedAt))))}</span>`:''}</button>
${hasKids?`<span class="tree-pct">${p}%</span>`:t.availability!=='ready'?`<span class="tag ${t.availability==='blocked'?'red':'gold'}">${h(AVAIL[t.availability])}</span>`:''}
<button class="tree-iconbtn" data-action="new-task" data-goal="${h(t.goalId)}" data-parent="${h(t.id)}" aria-label="子TODOを追加">＋</button></div>
${hasKids&&!collapsed?`<ul class="tree-children">${kids.map(treeNode).join('')}</ul>`:''}</li>`}
function renderExecute(){const g=goalById(ui.activeGoal);if(!g)return '';const leaves=goalTasks(g.id).filter(isLeaf);
 const filtered=leaves.filter(t=>ui.execFilter==='all'||(ui.execFilter==='ready'?t.availability==='ready'&&t.status!=='done':ui.execFilter==='today'?t.plannedDate===today():t.status==='done'));
 // Order by deadline, then planned working date; undated items appear last. Never sort by "today" ahead of older deadlines.
 const sortDate=t=>isDate(t.dueDate)?t.dueDate:isDate(t.plannedDate)?t.plannedDate:'9999-12-31';
 filtered.sort((a,b)=>sortDate(a).localeCompare(sortDate(b))||(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||a.createdAt.localeCompare(b.createdAt));
 return `<section class="card"><div class="soft-head">${icon('check','icon-mini')} ${h(g.title)}：実行リスト</div><div class="panel-body"><div class="filterbar"><select data-change="exec-filter" aria-label="TODOの絞り込み"><option value="ready" ${ui.execFilter==='ready'?'selected':''}>実行可能・未完了</option><option value="today" ${ui.execFilter==='today'?'selected':''}>今日のTODO</option><option value="done" ${ui.execFilter==='done'?'selected':''}>完了済み</option><option value="all" ${ui.execFilter==='all'?'selected':''}>すべて</option></select><span class="muted">完了予定日 → 取り組む日の順に時系列で表示（未設定は末尾）</span></div>
 ${filtered.length?filtered.map(t=>`<div class="task-row"><button class="checkbox ${t.status==='done'?'checked':''}" data-action="toggle-task" data-id="${h(t.id)}" aria-label="${t.status==='done'?'未完了に戻す':'完了する'}">${icon('check')}</button><div class="task-info"><strong class="${t.status==='done'?'done-text':''}">${h(t.title)}</strong><div class="task-meta">${dueTag(t.dueDate,'完了予定')} ${t.plannedDate&&isDate(t.plannedDate)?`<span class="date-chip work-chip">着手日 ${h(shortDate(t.plannedDate))}</span>`:''}${t.status==='done'&&t.completedAt?`<span class="date-chip finished-chip">完了実績 ${h(shortDate(dstr(new Date(t.completedAt))))}</span>`:''}</div><small>${h(t.doneCriteria||AVAIL[t.availability]||'')}</small></div><div class="task-actions">${t.status!=='done'?`<button class="pale-button" data-action="plan-task" data-id="${h(t.id)}">${t.plannedDate===today()?'今日から外す':'今日に追加'}</button>`:''}<button class="pale-button" data-action="edit-task" data-id="${h(t.id)}">編集</button></div></div>`).join(''):empty('check','該当するTODOがありません','別の絞り込みを選ぶか、ツリーでTODOを作成してください。')}
 </div></section>`
}
/** Selected-goal calendar. A task's due date is its checkpoint; if a pre-v1.1 task
 * has only a working date, that date is shown as a clearly labeled provisional checkpoint.
 * The connecting line is derived from the earliest checkpoint and the goal date. */
function calendarTaskDate(t){
 if(isDate(t.dueDate))return {date:t.dueDate,dateType:'due'};
 if(isDate(t.plannedDate))return {date:t.plannedDate,dateType:'planned'};
 return null;
}
function renderCalendar(){
 const goal=goalById(ui.activeGoal);if(!goal)return '';
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(ui.calendarMonth))ui.calendarMonth=today().slice(0,7);
 const group=data.groups.find(g=>g.id===goal.groupId);
 const goalTasksAll=goalTasks(goal.id);
 const tasks=goalTasksAll.map(t=>{const dateInfo=calendarTaskDate(t);return dateInfo?{...dateInfo,kind:'task',date:dateInfo.date,title:t.title,id:t.id,done:t.status==='done'}:null}).filter(Boolean);
 const missingTasks=goalTasksAll.filter(t=>!calendarTaskDate(t));
 const milestones=[];
 if(isDate(goal.dueDate))milestones.push({kind:'goal',date:goal.dueDate,title:goal.title,id:goal.id});
 if(group&&isDate(group.dueDate))milestones.push({kind:'group',date:group.dueDate,title:group.name,id:group.id});
 milestones.push(...tasks);
 const byDate=new Map();milestones.forEach(x=>{if(!byDate.has(x.date))byDate.set(x.date,[]);byDate.get(x.date).push(x)});
 const [y,m]=ui.calendarMonth.split('-').map(Number);
 const first=new Date(y,m-1,1,12),firstWeekday=first.getDay(),daysInMonth=new Date(y,m,0,12).getDate();
 const count=Math.ceil((firstWeekday+daysInMonth)/7)*7;
 const begin=dstr(new Date(y,m-1,1-firstWeekday,12));
 const goalDue=isDate(goal.dueDate)?goal.dueDate:null;
 const firstCheckpoint=tasks.map(t=>t.date).sort()[0]||null;
 // Always show the connecting path when both endpoints exist, even if dates were entered in reverse.
 const rangeStart=firstCheckpoint&&goalDue?(firstCheckpoint<goalDue?firstCheckpoint:goalDue):null;
 const rangeEnd=firstCheckpoint&&goalDue?(firstCheckpoint>goalDue?firstCheckpoint:goalDue):null;
 const onPath=d=>rangeStart&&rangeEnd&&d>=rangeStart&&d<=rangeEnd;
 const todayDay=today();
 const weeks=[];
 for(let offset=0;offset<count;offset+=7){let cells='';for(let col=0;col<7;col++){
  const day=stepDay(begin,offset+col),items=byDate.get(day)||[],goalHere=items.some(x=>x.kind==='goal'),todoHere=items.filter(x=>x.kind==='task'),groupHere=items.some(x=>x.kind==='group');
  let segment='';if(onPath(day)){segment=rangeStart===rangeEnd?'single':day===rangeStart?'start':day===rangeEnd?'end':'middle'}
  const symbols=(todoHere.some(x=>!x.done)?`<span class="calendar-node node-task" title="未完了の子TODO"></span>`:'')+(todoHere.some(x=>x.done)?`<span class="calendar-node node-task node-task-done" title="完了済みの子TODO"></span>`:'')+(goalHere?`<span class="calendar-node node-goal" title="目標の完了予定日"></span>`:'');
  const label=items.map(x=>`${x.kind==='goal'?'目標':x.kind==='group'?'グループ':x.dateType==='planned'?'子TODOの取り組む日':'子TODOの完了予定日'}：${x.title}${x.kind==='task'?(x.done?'（完了済み）':'（未完了）'):''}`).join('、');
  cells+=`<button class="calendar-day ${day.slice(0,7)===ui.calendarMonth?'':'outside'} ${day===todayDay?'is-today':''} ${day===ui.calendarSelected?'selected':''}" data-action="calendar-day" data-day="${day}" aria-label="${h(niceDay(day,false)+(label?' '+label:''))}" aria-pressed="${day===ui.calendarSelected}"><span class="calendar-number">${Number(day.slice(-2))}${groupHere?'<span class="calendar-group-glyph" title="グループの完了予定日">◆</span>':''}</span><span class="calendar-labels">${goalHere?'<span class="calendar-label goal-label">目標の期限</span>':''}${todoHere.length?`<span class="calendar-label todo-label ${todoHere.every(x=>x.done)?'todo-label-done':''}">子TODO ${todoHere.length}件 ${todoHere.every(x=>x.done)?'完了':''}</span>`:''}${groupHere?'<span class="calendar-label group-label">グループ</span>':''}</span><span class="calendar-rail ${segment?'rail-'+segment:''}">${symbols?`<span class="calendar-node-set">${symbols}</span>`:''}</span></button>`;
 }weeks.push(`<div class="calendar-week">${cells}</div>`)}
 const priority={group:0,task:1,goal:2};
 const viewItems=(byDate.get(ui.calendarSelected)||[]).sort((a,b)=>priority[a.kind]-priority[b.kind]);
 const upcoming=milestones.slice().sort((a,b)=>a.date.localeCompare(b.date)||priority[a.kind]-priority[b.kind]);
 const lateTasks=goalDue?tasks.filter(t=>t.date>goalDue):[];
 const outsideMonthCount=milestones.filter(x=>x.date.slice(0,7)!==ui.calendarMonth).length;
 return `<section class="card calendar-card"><div class="calendar-heading"><div><div class="eyebrow">MILESTONE CALENDAR</div><h3>予定と通過点</h3><p>選択中の目標：<strong>${h(goal.title)}</strong></p></div><div class="calendar-controls"><button class="pale-button" data-action="calendar-step" data-step="-1" aria-label="前月へ">‹</button><strong>${y}年${m}月</strong><button class="pale-button" data-action="calendar-step" data-step="1" aria-label="翌月へ">›</button><button class="outline-btn small-btn" data-action="calendar-today">今月</button></div></div>
 <div class="calendar-legend"><span><i class="legend-mark goal-mark"></i> 目標の完了予定</span><span><i class="legend-mark task-mark"></i> 未完了TODO（赤○）</span><span><i class="legend-mark task-done-mark"></i> 完了済みTODO（緑●）</span><span><i class="legend-group-mark">◆</i> グループの完了予定</span><span><i class="legend-line"></i> 通過点から目標まで</span></div>
 <div class="calendar-area"><div class="calendar-weekdays">${['日','月','火','水','木','金','土'].map(x=>`<span>${x}</span>`).join('')}</div>${weeks.join('')}</div>
 <p class="calendar-hint">子TODOは未完了なら赤○、完了済みなら緑●です（進行中・保留も未完了扱い）。完了予定日が未設定の場合は「取り組む日」を使います。赤線は最初の子TODOの予定日と目標期限を結びます。</p>
 ${!goalDue?`<div class="calendar-guidance">${icon('calendar','icon-mini')}<span>目標の完了予定日が未設定のため、目標へ向かう赤線を引けません。</span><button class="outline-btn small-btn" data-action="edit-goal" data-id="${h(goal.id)}">目標の日付を設定</button></div>`:''}
 ${!tasks.length?`<div class="calendar-guidance">${icon('tree','icon-mini')}<span>子TODOの予定日がまだありません。子TODOの「完了予定日」または「取り組む日」を設定すると赤い○が表示されます。</span><button class="outline-btn small-btn" data-action="todo-tab" data-view="tree">ツリーで設定する</button></div>`:''}
 ${tasks.length&&missingTasks.length?`<div class="calendar-guidance subtle">日付未設定の子TODOが ${missingTasks.length} 件あります（${missingTasks.slice(0,2).map(t=>h(t.title)).join('、')}${missingTasks.length>2?' ほか':''}）。</div>`:''}
 ${milestones.length&&outsideMonthCount===milestones.length?`<div class="calendar-guidance subtle">この月には予定がありません。下の「予定日一覧」から日付を選ぶと、その月へ移動できます。</div>`:''}
 ${lateTasks.length?`<div class="calendar-warning">${icon('calendar','icon-mini')} 目標の完了予定日より後に予定された子TODOが ${lateTasks.length} 件あります。日程を確認してください。</div>`:''}
 <div class="calendar-detail"><div class="calendar-detail-head"><strong>${icon('calendar','icon-mini')} ${h(niceDay(ui.calendarSelected,false))} の予定</strong><button class="ghost-btn" data-action="edit-goal" data-id="${h(goal.id)}">目標を編集</button></div>
 ${viewItems.length?viewItems.map(item=>`<div class="calendar-event"><span class="event-symbol ${h(item.kind)} ${item.done?'task-done':''}">${item.kind==='goal'?'●':item.kind==='task'?(item.done?'●':'○'):'◆'}</span><div><strong>${h(item.title)}</strong><small>${item.kind==='goal'?'目標の完了予定':item.kind==='group'?'グループの完了予定':item.dateType==='planned'?'子TODOの取り組む日（完了予定日未設定）':'子TODOの完了予定'}${item.kind==='task'?(item.done?' ／ 完了済み':' ／ 未完了'):''}</small></div><button class="pale-button" data-action="${item.kind==='goal'?'edit-goal':item.kind==='group'?'edit-group':'edit-task'}" data-id="${h(item.id)}">編集</button></div>`).join(''):`<p class="empty-note">この日に設定された予定はありません。</p>`}</div>
 <div class="calendar-deadlines"><h4>予定日一覧</h4>${upcoming.length?upcoming.map(item=>`<button class="deadline-row" data-action="calendar-jump" data-day="${h(item.date)}"><span class="event-symbol ${h(item.kind)} ${item.done?'task-done':''}">${item.kind==='goal'?'●':item.kind==='task'?(item.done?'●':'○'):'◆'}</span><span>${h(item.title)}${item.kind==='task'&&item.dateType==='planned'?'<small class="deadline-sub">取り組む日（暫定）</small>':''}</span><time>${h(niceDay(item.date,false))}</time></button>`).join(''):`<div class="empty-note">まだ予定日がありません。グループ・目標・子TODOの編集画面で日付を設定してください。</div>`}</div>
 </section>`;
}
// 通勤記録：事前に登録した装備と緊急連絡先は保存しますが、出発チェックの状態は保存しません。
function commuteTabButton(view,label,ico){return `<button class="tab ${ui.commuteView===view?'active':''}" data-action="commute-tab" data-view="${view}" role="tab" aria-selected="${ui.commuteView===view}">${icon(ico,'icon-mini')} ${h(label)}</button>`}
function renderCommute(){
 const commute=ensureCommuteState();
 return `${header('通勤記録','出発の準備と移動の状況を、ひとつの手帳で確認します。','COMMUTE JOURNAL',`<button class="outline-btn small-btn" data-action="commute-tab" data-view="contacts">${icon('phone','icon-mini')} 緊急連絡先</button>`)}
 <div class="tabs commute-tabs" role="tablist" aria-label="通勤記録の表示方法">${commuteTabButton('check','出発チェック','check')}${commuteTabButton('log','通勤ログ','calendar')}${commuteTabButton('contacts','緊急連絡先','phone')}</div>
 ${ui.commuteView==='check'?renderCommuteChecklist(commute):ui.commuteView==='log'?renderCommuteLog(commute):renderCommuteContacts(commute)}`;
}
function renderCommuteChecklist(commute){
 const items=commute.equipment;
 return `<div class="commute-layout"><section class="card"><div class="soft-head">${icon('check','icon-mini')} 出発前の装備チェック <button class="outline-btn small-btn" data-action="new-equipment">${icon('plus','icon-mini')} 装備を登録</button></div>
 <div class="panel-body"><div class="notice-bar">${icon('shield','icon-mini')}<span>チェックはその場限りの確認用です。記録・バックアップには保存されず、この画面を離れるとリセットされます。登録した装備名は保存されます。</span></div>
 ${items.length?EQUIPMENT_CATEGORIES.map(cat=>{const group=items.filter(x=>x.category===cat);return group.length?`<div class="commute-check-group"><h3>${h(cat)} <small>${group.length}件</small></h3>${group.map(x=>`<div class="commute-check-row"><button class="checkbox ${ui.commuteChecked.has(x.id)?'checked':''}" role="checkbox" aria-checked="${ui.commuteChecked.has(x.id)}" data-action="equip-check" data-id="${h(x.id)}" aria-label="${h(x.title)}を確認">${icon('check')}</button><span class="commute-check-label ${ui.commuteChecked.has(x.id)?'done-text':''}">${h(x.title)}</span><button class="pale-button" data-action="edit-equipment" data-id="${h(x.id)}">編集</button></div>`).join('')}</div>`:''}).join(''):`<div class="empty-state small-empty">${icon('briefcase')}<h3>装備を登録しましょう</h3><p>服装や毎日使う持ち物を登録すると、出発前にチェックできます。</p><button class="primary-btn small-btn" data-action="new-equipment">最初の装備を登録</button></div>`}
 ${items.length?`<div class="commute-check-foot"><span id="equip-count">${ui.commuteChecked.size} / ${items.length} 件確認</span><button class="outline-btn small-btn" data-action="equip-reset">チェックをすべて外す</button></div>`:''}</div></section>
 <div class="stack"><section class="card"><div class="soft-head">${icon('train','icon-mini')} 今日の通勤</div><div class="panel-body"><p class="help-copy">天気・混雑・時間の余裕は「通勤ログ」に保存します。装備チェックの結果は通勤ログに含まれません。</p><button class="primary-btn w100" data-action="commute-today-log">${icon('pen','icon-mini')} 今日の通勤を記録</button></div></section>
 <section class="card"><div class="soft-head">${icon('phone','icon-mini')} 万一のときに</div><div class="panel-body"><p class="help-copy">緊急連絡先はオフラインでも、この端末に保存されていれば確認できます。</p>${commute.contacts.length?`<strong>${h(commute.contacts[0].name)}</strong><div class="mt10">${phoneLink(commute.contacts[0].phone)}</div>`:`<p class="muted">緊急連絡先が登録されていません。</p>`}<button class="outline-btn small-btn mt10" data-action="commute-tab" data-view="contacts">すべての連絡先を見る</button></div></section></div></div>`;
}
function phoneLink(phone){const tel=String(phone||'').replace(/[^0-9+]/g,'');return tel?`<a class="phone-link" href="tel:${h(tel)}">${icon('phone','icon-mini')} ${h(phone)}</a>`:'<span>電話番号未登録</span>'}
function renderCommuteLog(commute){
 const d=ui.commuteDay,log=commute.entries[d]||{},history=Object.entries(commute.entries).filter(([date])=>isDate(date)).sort(([a],[b])=>b.localeCompare(a)).slice(0,14);
 const options=(arr,val)=>arr.map(([key,label])=>`<option value="${h(key)}" ${key===val?'selected':''}>${h(label)}</option>`).join('');
 return `<div class="commute-layout"><section class="card"><div class="soft-head">${icon('calendar','icon-mini')} 日別の通勤ログ</div><div class="panel-body">
 <div class="commute-daynav"><button class="pale-button" data-action="commute-step" data-step="-1" aria-label="前日">‹</button><label>記録する日 <input type="date" id="commute-date" value="${h(d)}" data-change="commute-date" aria-label="通勤した日"></label><button class="pale-button" data-action="commute-step" data-step="1" aria-label="翌日">›</button><button class="outline-btn small-btn" data-action="commute-date-today">今日</button></div>
 <form id="commute-form" class="field-group mt15"><div class="field-row"><div class="field"><label for="commute-transport">通勤手段</label><select id="commute-transport" name="transport">${options(TRANSPORT_OPTIONS,log.transport||'')}</select></div><div class="field"><label for="commute-weather">通勤時の天気</label><select id="commute-weather" name="weather">${options(WEATHER_OPTIONS,log.weather||'')}</select></div></div>
 <div class="field-row"><div class="field"><label for="commute-crowd">電車・道路などの混み具合</label><select id="commute-crowd" name="crowding">${options(CROWD_OPTIONS,log.crowding||'')}</select></div><div class="field"><label for="commute-buffer">時間に余裕を持てたか</label><select id="commute-buffer" name="buffer">${options(BUFFER_OPTIONS,log.buffer||'')}</select></div></div>
 <div class="field"><label for="commute-memo">通勤中の気づき・メモ（任意）</label><textarea id="commute-memo" name="memo" rows="4" placeholder="例：雪の日は一本早い電車だと落ち着いて移動できた">${h(log.memo||'')}</textarea></div>
 <p class="help-copy">「記録を保存」を押すと、選択中の日付の通勤状況だけを保存します。装備チェックの結果は保存されません。</p>
 <div class="commute-form-actions"><button type="submit" class="primary-btn">${icon('check','icon-mini')} 通勤記録を保存</button>${commute.entries[d]?`<button type="button" class="danger-btn small-btn" data-action="delete-commute-log" data-day="${h(d)}">この日の記録を削除</button>`:''}</div></form></div></section>
 <section class="card"><div class="soft-head">${icon('note','icon-mini')} 最近の通勤記録</div><div class="panel-body">${history.length?history.map(([date,r])=>`<button class="commute-history-row" data-action="commute-jump" data-day="${h(date)}"><time>${h(niceDay(date,false))}</time><span>${h(optionLabel(WEATHER_OPTIONS,r.weather))} · ${h(optionLabel(CROWD_OPTIONS,r.crowding))}</span><span class="tag ${r.buffer==='late'?'red':r.buffer==='enough'?'green':'gray'}">${h(optionLabel(BUFFER_OPTIONS,r.buffer))}</span></button>`).join(''):`<div class="empty-note">通勤記録はまだありません。今日の天気や混雑状況から記録しましょう。</div>`}</div></section></div>`;
}
function renderCommuteContacts(commute){const contacts=commute.contacts;return `<section class="card"><div class="soft-head">${icon('phone','icon-mini')} 非常時の連絡先 <button class="outline-btn small-btn" data-action="new-contact">${icon('plus','icon-mini')} 連絡先を登録</button></div><div class="panel-body"><div class="notice-bar">${icon('shield','icon-mini')}<span>連絡先はこの端末のブラウザに保存され、通常の保存領域では暗号化されません。共有端末や勤務先の許可がない端末では個人情報の登録を避けてください。</span></div>
 ${contacts.length?`<div class="contact-grid">${contacts.map(c=>`<article class="contact-card"><div class="contact-card-head"><h3>${h(c.name)}</h3><button class="pale-button" data-action="edit-contact" data-id="${h(c.id)}">編集</button></div>${phoneLink(c.phone)}${c.description?`<p class="preline">${h(c.description)}</p>`:''}</article>`).join('')}</div>`:`<div class="empty-state small-empty">${icon('phone')}<h3>連絡先を登録しましょう</h3><p>会社の代表電話や緊急時に連絡する窓口などを登録できます。</p><button class="primary-btn small-btn" data-action="new-contact">連絡先を登録</button></div>`}
 <p class="help-copy mt15">電話番号をタップすると端末の電話機能を開きます。アプリが自動で発信することはありません。</p></div></section>`}
function renderResearch(){let list=data.notes.slice().filter(n=>(ui.researchType==='all'||n.kind===ui.researchType)&&[n.title,n.details,n.action,n.result,n.cause,n.nextStep,n.tags].join(' ').toLowerCase().includes(ui.researchQuery.toLowerCase())).sort((a,b)=>(b.date+b.updatedAt).localeCompare(a.date+a.updatedAt));return `${header('研究ノート','気づきや判断の理由を残し、次の仕事に活かします。','RESEARCH NOTE',`<button class="primary-btn small-btn" data-action="new-note">${icon('plus','icon-mini')} 記録を追加</button>`)}
<div class="filterbar"><div class="search-wrap">${icon('search')}<input id="research-search" data-search="research" value="${h(ui.researchQuery)}" placeholder="研究ノートを検索" aria-label="ノートを検索"></div><select data-change="note-filter" aria-label="ノートの種類"><option value="all">すべての種類</option>${Object.entries(NOTE_TYPES).map(([k,v])=>`<option value="${k}" ${ui.researchType===k?'selected':''}>${h(v)}</option>`).join('')}</select></div>
<div class="data-summary mb0" style="margin-bottom:17px"><div><b>${data.notes.length}</b><small>総記録数</small></div><div><b>${data.notes.filter(n=>n.kind==='insight').length}</b><small>気づき</small></div><div><b>${data.notes.filter(n=>n.status==='closed').length}</b><small>確認・完了</small></div></div>
${list.length?`<div class="list-grid">${list.map(n=>`<article class="note-item"><div class="note-meta"><span class="tag ${n.kind==='success'?'green':n.kind==='failure'?'red':''}">${h(NOTE_TYPES[n.kind])}</span><span class="tag ${n.status==='closed'?'green':'gray'}">${h(NOTE_STATUS[n.status]||n.status)}</span><span class="minilabel">${niceDay(n.date,false)}</span></div><h3>${h(n.title)}</h3><p>${h([n.details,n.action].filter(Boolean).join(' ／ ').slice(0,180))}${[n.details,n.action].join(' ').length>180?'…':''}</p><div class="note-footer"><small class="minilabel">${n.tags?h(n.tags):'記録を振り返ってみましょう'}</small><button class="outline-btn small-btn" data-action="edit-note" data-id="${h(n.id)}">${icon('pen','icon-mini')} 開いて編集</button></div></article>`).join('')}</div>`:empty('book','記録が見つかりません','気づき・成功・失敗・判断を、短いメモから残しましょう。',`<button class="outline-btn small-btn" data-action="new-note">最初のメモを作る</button>`)}`}
function dateRange(period){const end= parseDay(today());let start=new Date(end);if(period==='week'){const shift=(end.getDay()+6)%7;start.setDate(end.getDate()-shift)}else if(period==='month'){start=new Date(end.getFullYear(),end.getMonth(),1,12)}else start.setDate(end.getDate()-29);return {start:dstr(start),end:dstr(end)}}
function periodData(period){const {start,end}=dateRange(period);const entries=Object.entries(data.days).filter(([d,v])=>d>=start&&d<=end&&hasDayRecord(v)).sort(([a],[b])=>a.localeCompare(b));const notes=data.notes.filter(n=>n.date>=start&&n.date<=end),tasks=data.tasks.filter(t=>t.completedAt&&dstr(new Date(t.completedAt))>=start&&dstr(new Date(t.completedAt))<=end&&isLeaf(t));return {entries,notes,tasks,start,end}}
function hasDayRecord(d){return d&&(['summary','achievements','challenges','notices','tomorrow','praise'].some(k=>String(d[k]||'').trim())||Object.values(d.ratings||{}).some(v=>v))}
function renderReflection(){const p=periodData(ui.reflectionPeriod);const ratings=RATING_FIELDS.map(([key,label])=>{const vals=p.entries.map(([,v])=>v.ratings?.[key]).filter(x=>Number.isInteger(x)&&x>=1&&x<=5);return {key,label,mean:vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length):0,count:vals.length}});
return `${header('振り返りと成長','数を競うのではなく、次の行動を見つけるための記録です。','REFLECTION',`<button class="primary-btn small-btn" data-action="open-prompt" data-type="review">${icon('copy','icon-mini')} AI用の振り返り文章</button>`)}
<div class="tabs"><button class="tab ${ui.reflectionPeriod==='week'?'active':''}" data-action="period" data-period="week">今週</button><button class="tab ${ui.reflectionPeriod==='month'?'active':''}" data-action="period" data-period="month">今月</button><button class="tab ${ui.reflectionPeriod==='30days'?'active':''}" data-action="period" data-period="30days">直近30日</button></div><p class="muted">対象期間：${niceDay(p.start,false)} 〜 ${niceDay(p.end,false)}</p>
<div class="grid3 mt15"><div class="metric"><b>${p.entries.length}</b><small>記録した日数</small></div><div class="metric"><b>${p.notes.length}</b><small>研究メモ</small></div><div class="metric"><b>${p.tasks.length}</b><small>完了した末端TODO</small></div></div>
<div class="grid2 mt20"><section class="card"><div class="soft-head">${icon('chart','icon-mini')} 自己評価の平均（5点満点）</div><div class="panel-body"><div class="chart-list">${ratings.map(r=>`<div class="chart-line"><span>${h(r.label)}</span><div class="progress-bar"><span class="progress-fill" style="width:${r.mean*20}%"></span></div><strong>${r.count?r.mean.toFixed(1):'—'}</strong></div>`).join('')}</div><div class="tip mt15">記録のなかった項目は平均に含めません。数字は成長のヒントとして利用しましょう。</div></div></section>
<section class="card"><div class="soft-head">${icon('calendar','icon-mini')} 一日ごとの評価</div><div class="panel-body">${p.entries.filter(([,d])=>Object.values(d.ratings||{}).some(Boolean)).length?`<div class="chart-list">${p.entries.filter(([,d])=>Object.values(d.ratings||{}).some(Boolean)).slice().reverse().slice(0,12).map(([date,day])=>{const vals=Object.values(day.ratings||{}).filter(x=>Number.isInteger(x)&&x>0);const mean=vals.reduce((a,b)=>a+b,0)/vals.length;return `<div class="daily-avg"><time>${niceDay(date,false)}</time><div class="progress-bar"><span class="progress-fill" style="width:${mean*20}%"></span></div><strong>${mean.toFixed(1)}</strong></div>`}).join('')}</div>`:`<div class="empty-note">業務記録の「自己評価」を入力すると、ここに表示されます。</div>`}</div></section></div>
<section class="card mt20"><div class="soft-head">${icon('book','icon-mini')} この期間の主な記録</div><div class="panel-body">${p.notes.length?p.notes.slice().reverse().slice(0,8).map(n=>`<div class="daily-todo"><span class="tag">${h(NOTE_TYPES[n.kind])}</span><button class="text-btn" style="flex:1;text-align:left" data-action="edit-note" data-id="${h(n.id)}">${h(n.title)}</button><small>${shortDate(n.date)}</small></div>`).join(''):`<div class="empty-note">この期間の研究ノートはまだありません。</div>`}</div></section>
<div class="notice-bar mt20">${icon('target','icon-mini')}<span>記録件数は仕事の能力そのものではありません。得た学びが、次の行動や判断にどう活かされたかを大切にしましょう。</span></div>`}
function renderSettings(){return `${header('設定・データ管理','情報の保存と、AIへ渡す文章を慎重に管理します。','PREFERENCES')}
<div class="settings-grid"><section class="settings-panel"><h3>${icon('shield')} 保存方式と情報保護</h3><p>現在の保存方式：<strong class="${storeMethod==='memory'?'storage-warn':'storage-ok'}">${h(storeMethod==='IndexedDB'?'端末内（IndexedDB）':storeMethod==='localStorage'?'端末内（localStorage）':'保存不可：一時メモリのみ')}</strong><br>データはこのブラウザの保存領域にあります。アプリは外部データベースや分析サービスに接続しません。ただし、ブラウザ保存領域は暗号化されておらず、端末・ブラウザの設定によって消去される場合があります。</p><div class="notice-bar">${icon('shield','icon-mini')}<span>個人端末への業務情報保存や外部AIへの入力が許可されるか、必ず勤務先の情報管理規程を確認してください。クラウド型ホスティングに配置した場合も、記録内容の送信機能はありません。</span></div></section>
<section class="settings-panel"><h3>${icon('copy')} 暗号化バックアップ</h3><p>パスワードを使ってAES-GCM方式で暗号化したバックアップをファイルに保存します。別の端末に移す場合は、このファイルを読み込めます。パスワードを失うと復元できません。</p><div class="settings-actions"><button class="primary-btn" data-action="backup">${icon('shield','icon-mini')} 暗号化して書き出す</button><button class="outline-btn" data-action="restore">${icon('folder','icon-mini')} バックアップから復元</button></div></section>
<section class="settings-panel"><h3>${icon('chart')} 保存データの概要</h3><div class="data-summary"><div><b>${data.goals.length}</b><small>目標</small></div><div><b>${data.tasks.length}</b><small>TODO</small></div><div><b>${data.notes.length}</b><small>研究メモ</small></div></div><p class="mt10">通勤記録：${Object.keys(ensureCommuteState().entries).length}日分／装備：${data.commute.equipment.length}件／緊急連絡先：${data.commute.contacts.length}件。</p><p class="mt10">業務記録：${Object.values(data.days).filter(hasDayRecord).length}日分。ブラウザデータを消去すると、この記録も消えることがあります。</p></section>
<section class="settings-panel"><h3>${icon('copy')} AI用プロンプト</h3><p>日報や週次振り返りを、外部AIに貼り付けるための文章に変換します。生成・コピーだけではAIに送信されません。貼り付ける前に、社名・顧客・担当者・社内の事情・価格・契約条件などを削除してください。</p><button class="outline-btn" data-action="open-prompt" data-type="daily">${icon('copy','icon-mini')} プロンプト生成を開く</button></section>
<section class="settings-panel"><h3>${icon('shield')} iPhone・オフライン利用</h3>
<p>アプリの版：<strong>Ver.${APP_VERSION}</strong><br>起動方法：<strong id="pwa-installed-status">確認中</strong><br>オフライン利用：<strong id="pwa-current-status">確認中</strong><br>通信：<strong id="pwa-network-status">確認中</strong></p>
<div class="notice-bar">${icon('shield','icon-mini')}<span>初回はオンラインで一度開き、オフライン準備完了を確認してください。SafariとiPhoneのホーム画面アプリでは、保存データが別々になる場合があります。バックアップで移行してください。</span></div>
<p class="mt10" id="pwa-update-text">更新があれば、この欄から確認できます。</p>
<div class="settings-actions"><button class="outline-btn" data-action="check-app-update">${icon('calendar','icon-mini')} 新しい版を確認</button><button id="pwa-apply-update" class="primary-btn" data-action="apply-app-update" hidden>更新を適用して再起動</button></div>
</section>
<section class="settings-panel"><h3>データの初期化</h3><p>このブラウザ内の業務研究室のデータを全件削除します。この操作は取り消せません。必要なデータをバックアップしてから実行してください。</p><button class="danger-btn small-btn" data-action="clear-data">すべての記録を削除</button></section></div>`}
function modalMarkup(title,body,footer=''){return `<div class="modal-layer" data-action="close-outside"><div class="modal" role="dialog" aria-modal="true" aria-label="${h(title)}"><div class="modal-head"><h2>${h(title)}</h2><button class="modal-close" data-action="close-modal" aria-label="閉じる">×</button></div><div class="modal-body">${body}</div>${footer?`<div class="modal-foot">${footer}</div>`:''}</div></div>`}
function footerButtons(archive='',submit='保存する'){return `${archive}<div class="right"><button class="outline-btn" data-action="close-modal">キャンセル</button><button class="primary-btn" type="submit" form="modal-form">${h(submit)}</button></div>`}
function inputField(label,name,value='',opts={}){return `<div class="field"><label for="m-${h(name)}">${h(label)}</label>${opts.textarea?`<textarea id="m-${h(name)}" name="${h(name)}" rows="${opts.rows||3}" placeholder="${h(opts.placeholder||'')}">${h(value)}</textarea>`:`<input id="m-${h(name)}" name="${h(name)}" type="${opts.type||'text'}" value="${h(value)}" ${opts.required?'required':''} placeholder="${h(opts.placeholder||'')}" ${opts.max?`maxlength="${opts.max}"`:''}>`}${opts.help?`<small>${h(opts.help)}</small>`:''}</div>`}
function selectField(label,name,options,value){return `<div class="field"><label for="m-${h(name)}">${h(label)}</label><select name="${h(name)}" id="m-${h(name)}">${options.map(([key,text])=>`<option value="${h(key)}" ${key===value?'selected':''}>${h(text)}</option>`).join('')}</select></div>`}
function showModal(type,opts={}){ui.modal={type,...opts};renderModal();setTimeout(()=>$('#modal-root input:not([type="hidden"]),#modal-root textarea,#modal-root select')?.focus(),10)}
function hideModal(){ui.modal=null;$('#modal-root').innerHTML=''}
function renderModal(){const m=ui.modal;if(!m){$('#modal-root').innerHTML='';return}let title='',body='',footer='';
switch(m.type){
case 'group': {const g=data.groups.find(x=>x.id===m.id);title=g?'グループを編集':'グループを作成';body=`<form id="modal-form" data-form="group" class="field-group">${inputField('グループ名','name',g?.name||'',{required:true,max:70,placeholder:'例：営業スキルの習得'})}${inputField('グループの完了予定日（任意）','dueDate',g?.dueDate||'',{type:'date',help:'グループ全体の達成を目指す日付です。カレンダーでは◆で表示します。'})}<p class="help-copy">グループは目標を整理するためのフォルダです。目標の中にTODOツリーを作ります。</p></form>`;footer=footerButtons(g?`<button class="danger-btn small-btn" data-action="delete-group" data-id="${h(g.id)}">削除</button>`:'');break}
case 'goal': {const g=goalById(m.id);title=g?'目標を編集':'目標を作成';const groupOpts=[['','未分類'],...data.groups.map(x=>[x.id,x.name])];body=`<form id="modal-form" data-form="goal" class="field-group">${inputField('達成したい目標','title',g?.title||'',{required:true,max:120,placeholder:'例：新商品の説明を一人でできるようになる'})}${selectField('所属グループ','groupId',groupOpts,g?.groupId||(!g&&ui.activeGroup!=='all'&&ui.activeGroup!=='ungrouped'?ui.activeGroup:''))}${inputField('目標の背景・目的','description',g?.description||'',{textarea:true,placeholder:'なぜ取り組むのか？'})}${inputField('達成したと判断できる条件','doneCriteria',g?.doneCriteria||'',{textarea:true,placeholder:'どの状態になれば達成か？'})}${inputField('目標の完了予定日（任意）','dueDate',g?.dueDate||'',{type:'date',help:'カレンダーでは赤い●で表示します。'})}</form>`;footer=footerButtons(g?`<button class="danger-btn small-btn" data-action="delete-goal" data-id="${h(g.id)}">目標とTODOを削除</button>`:'');break}
case 'task': {const t=taskById(m.id);const goalId=t?.goalId||m.goalId;const goal=goalById(goalId);title=t?'TODOを編集':'子TODOを追加';if(!goal){hideModal();return}body=`<form id="modal-form" data-form="task" class="field-group"><div class="tip">目標：${h(goal.title)}${m.parentId?`<br>一歩後の行動：${h(taskById(m.parentId)?.title||'')}`:''}</div>${inputField('実行する行動','title',t?.title||'',{required:true,max:160,placeholder:'例：製品資料を10分読む'})}${inputField('目的・手順（任意）','description',t?.description||'',{textarea:true,placeholder:'どのように進める？'})}${inputField('完了条件（任意）','doneCriteria',t?.doneCriteria||'',{textarea:true,placeholder:'例：主要な機能を3つ説明できる'})}${inputField('実行条件（任意）','trigger',t?.trigger||'',{placeholder:'例：製品資料が手元にあるとき'})}<div class="field-row">${selectField('実行可能性','availability',Object.entries(AVAIL),t?.availability||'ready')}${selectField('状態','status',Object.entries(TASK_STATUS),t?.status||'todo')}</div><div class="field-row">${inputField('取り組む日（任意）','plannedDate',t?.plannedDate||'',{type:'date',help:'今日に設定するとホームにも表示されます。'})}${inputField('完了予定日（任意）','dueDate',t?.dueDate||'',{type:'date',help:'カレンダーでは赤い○（通過点）で表示します。'})}</div>${t?.completedAt?`<div class="tip">実際の完了日：${h(niceDay(dstr(new Date(t.completedAt))))}</div>`:''}</form>`;footer=footerButtons(t?`<button class="danger-btn small-btn" data-action="delete-task" data-id="${h(t.id)}">この枝を削除</button>`:'');break}
case 'equipment': {const item=ensureCommuteState().equipment.find(x=>x.id===m.id);title=item?'装備を編集':'出発用の装備を登録';body=`<form id="modal-form" data-form="equipment" class="field-group">${inputField('装備名','title',item?.title||'',{required:true,max:90,placeholder:'例：冬用の革靴、社員証、手袋、傘'})}${selectField('分類','category',EQUIPMENT_CATEGORIES.map(x=>[x,x]),item?.category||'持ち物')}<p class="help-copy">装備名は保存されますが、毎朝のチェック状態は保存しません。</p></form>`;footer=footerButtons(item?`<button class="danger-btn small-btn" data-action="delete-equipment" data-id="${h(item.id)}">削除</button>`:'');break}
case 'contact': {const c=ensureCommuteState().contacts.find(x=>x.id===m.id);title=c?'緊急連絡先を編集':'緊急連絡先を登録';body=`<form id="modal-form" data-form="contact" class="field-group">${inputField('連絡先の名前・窓口','name',c?.name||'',{required:true,max:100,placeholder:'例：会社の代表電話、緊急連絡窓口'})}${inputField('電話番号','phone',c?.phone||'',{type:'tel',required:true,placeholder:'例：011-000-0000'})}${inputField('補足・連絡時の注意（任意）','description',c?.description||'',{textarea:true,placeholder:'例：交通機関の運休時はここに連絡'})}<div class="notice-bar">${icon('shield','icon-mini')}<span>個人情報や社内の連絡先を登録する前に、保存先が勤務先の規程に適合するか確認してください。</span></div></form>`;footer=footerButtons(c?`<button class="danger-btn small-btn" data-action="delete-contact" data-id="${h(c.id)}">削除</button>`:'');break}
case 'note': {const n=data.notes.find(x=>x.id===m.id);title=n?'研究メモを編集':'新しい研究メモ';body=`<form id="modal-form" data-form="note" class="field-group"><div class="field-row">${selectField('記録の種類','kind',Object.entries(NOTE_TYPES),n?.kind||m.kind||'insight')}${inputField('日付','date',n?.date||ui.day||today(),{type:'date',required:true})}</div>${inputField('タイトル','title',n?.title||'',{required:true,max:160,placeholder:'例：お客様への説明で気づいたこと'})}${inputField('出来事・状況','details',n?.details||'',{textarea:true,placeholder:'何が起こった？　何を観察した？'})}${inputField('自分の行動・選んだ方法','action',n?.action||'',{textarea:true,placeholder:'どのように対応した？ 他に選択肢はあった？'})}${inputField('理由・原因・仮説','cause',n?.cause||'',{textarea:true,placeholder:'なぜそうなった？ なぜその判断をした？'})}${inputField('結果・分かったこと','result',n?.result||'',{textarea:true,placeholder:'何が分かった？ 結果待ちなら空欄でも構いません。'})}${inputField('次に試すこと・確認すること','nextStep',n?.nextStep||'',{textarea:true,placeholder:'次の行動として何ができる？'})}<div class="field-row">${selectField('調査・進行状況','status',Object.entries(NOTE_STATUS),n?.status||'open')}${inputField('タグ','tags',n?.tags||'',{placeholder:'例：接客、商品知識'})}</div></form>`;footer=footerButtons(n?`<button class="danger-btn small-btn" data-action="delete-note" data-id="${h(n.id)}">削除</button>`:'');break}
case 'prompt': {title='AIに渡す文章を作成';body=`<p class="help-copy">コピーするだけでは送信されません。会社の機密情報が含まれていないことを必ず確認してください。</p><div class="field-row">${selectField('文章の用途','promptType',[['daily','業務報告'],['review','期間の振り返り'],['failure','失敗の原因分析'],['improve','改善案の検討']],m.promptType||'daily')}${selectField('対象範囲','promptPeriod',[['day','選択中の1日'],['week','今週'],['month','今月'],['30days','直近30日']],m.promptPeriod||(m.promptType==='review'?'week':'day'))}</div><div class="notice-bar mt15">${icon('shield','icon-mini')}<span><b>注意：</b>匿名加工はメールアドレスや電話番号など一部のパターンのみです。固有名詞・取引条件・社内事情などは自動判定できません。必ず本文を見直してください。</span></div>
<div class="check-row"><input type="checkbox" id="prompt-mask" checked><label for="prompt-mask">メールアドレス・URL・電話番号の候補を伏せる（補助機能）</label></div><div class="field"><label for="prompt-text">生成された文章（この欄で編集できます）</label><textarea class="prompter" id="prompt-text" spellcheck="false"></textarea></div><div class="check-row"><input type="checkbox" id="prompt-safety"><label for="prompt-safety">勤務先の規程に照らし、機密情報・個人情報がないことを確認しました。</label></div>`;footer=`<div class="right"><button class="outline-btn" data-action="refresh-prompt">文章を再生成</button><button class="primary-btn" data-action="copy-prompt" id="copy-prompt-btn" disabled>${icon('copy','icon-mini')} 確認してコピー</button></div>`;break}
case 'backup': {title='暗号化バックアップ';body=`<form id="modal-form" data-form="backup" class="field-group"><p class="help-copy">パスワードは12文字以上にしてください。復元時に必要です。端末内の保存データ自体は暗号化されません。</p>${inputField('暗号化パスワード','password','',{type:'password',required:true})}${inputField('パスワード（確認）','passwordAgain','',{type:'password',required:true})}<div class="notice-bar">${icon('shield','icon-mini')}<span>バックアップ形式：PBKDF2-SHA-256（250,000回）＋AES-256-GCM。パスワードを忘れると復元できません。</span></div></form>`;footer=footerButtons('','バックアップを保存');break}
case 'restore':{title='バックアップを復元';body=`<form id="modal-form" data-form="restore" class="field-group"><p class="help-copy">復元すると、この端末の現在の記録はすべて置き換わります。先に現在のバックアップを保存することをおすすめします。</p><div class="field"><label for="restore-file">暗号化バックアップ（.brlab）</label><input id="restore-file" name="file" type="file" required><p class="help-copy" id="restore-file-help">iPhoneでは「ファイルを選択」から「ファイル」アプリを開き、保存した .brlab を選んでください。ファイル形式による選択制限をなくしています。内容は復元前に検証します。</p><p class="help-copy" id="restore-file-selected" role="status" aria-live="polite"></p></div>${inputField('バックアップのパスワード','password','',{type:'password',required:true})}</form>`;footer=footerButtons('','内容を復元する');break}
}
$('#modal-root').innerHTML=modalMarkup(title,body,footer);
if(m.type==='prompt')refreshPrompt();
}
function promptRecords(period){if(period==='day'){const date=ui.day,day=data.days[date]||defaultDay(),notes=data.notes.filter(n=>n.date===date),tasks=data.tasks.filter(t=>isLeaf(t)&&t.completedAt&&dstr(new Date(t.completedAt))===date);return {start:date,end:date,entries:hasDayRecord(day)?[[date,day]]:[],notes,tasks}}return periodData(period)}
function makePrompt(type='daily',period='day'){
  const r=promptRecords(period);const title={daily:'上司に提出する業務報告',review:'期間の振り返り',failure:'失敗の原因分析',improve:'改善の具体策の検討'}[type]||'業務報告';
  let intro=`あなたは業務の振り返りを支援するアシスタントです。以下の私の記録に基づき「${title}」を支援してください。\n\n【基本条件】\n・記録にない事実、実績、数字は追加しないでください。\n・事実、考察、今後の行動を区別してください。\n・会社名・顧客名・個人名などを推測して補わないでください。\n・不明な点があれば不明と示してください。\n・記載内容に機密情報が含まれている可能性があれば、内容を展開する前に注意を促してください。\n`;
  if(type==='daily')intro+='・丁寧で簡潔な業務報告を200〜300文字程度で作成してください。\n';
  else if(type==='review')intro+='・今週/今月の成果、学び、課題、次に試す行動を簡潔にまとめてください。\n・単純な記録件数だけで能力を評価しないでください。\n';
  else if(type==='failure')intro+='・失敗を個人攻撃に結びつけず、事実と仮説を分けて原因を検討してください。\n・追加で確認すべき点を挙げ、再現性のある次の一歩を3つ提示してください。\n';
  else intro+='・対策は準備条件、具体的な行動、完了条件、検証方法を示してください。\n・後工程や他者の負担が増えないかも検討してください。\n';
  const text=[];r.entries.forEach(([date,d])=>{const a=[];for(const [k,label] of [['summary','取り組んだ業務'],['achievements','達成したこと'],['challenges','課題・失敗'],['notices','気づき'],['tomorrow','次の行動目標'],['praise','よかった行動']])if(String(d[k]||'').trim())a.push(`・${label}：${d[k]}`);const scores=RATING_FIELDS.filter(([k])=>d.ratings?.[k]).map(([k,l])=>`${l} ${d.ratings[k]}/5`);if(scores.length)a.push(`・自己評価：${scores.join('、')}`);if(a.length)text.push(`【${niceDay(date,false)}】\n${a.join('\n')}`)});
  if(r.tasks.length)text.push('【完了したTODO】\n'+r.tasks.map(t=>`・${t.title}（目標：${goalById(t.goalId)?.title||'不明'}）`).join('\n'));
  const selectedNotes=(type==='failure'?r.notes.filter(n=>n.kind==='failure'||n.kind==='decision'):type==='improve'?r.notes.filter(n=>n.kind==='insight'||n.kind==='improvement'):r.notes).slice(0,25);
  if(selectedNotes.length)text.push('【研究ノート】\n'+selectedNotes.map(n=>`・${NOTE_TYPES[n.kind]}「${n.title}」：状況 ${n.details||'記録なし'} ／ 行動 ${n.action||'記録なし'} ／ 考えた理由 ${n.cause||'記録なし'} ／ 結果 ${n.result||'未記録'} ／ 次の一歩 ${n.nextStep||'未記録'}`).join('\n'));
  if(!text.length)text.push('【記録】\n対象期間に入力された記録はありません。まず必要な項目を記録してください。');
  return `${intro}\n【対象期間】\n${niceDay(r.start,false)} 〜 ${niceDay(r.end,false)}\n\n${text.join('\n\n')}\n\n【お願い】\nこの記録を根拠に、具体的で実行可能な文章を提案してください。`;
}
function maskSensitive(text){return text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[メールアドレス]').replace(/https?:\/\/[^\s\]\)<>]+/gi,'[URL]').replace(/(?<!\d)(?:0\d{1,4}[-ー－]?\d{1,4}[-ー－]?\d{3,4})(?!\d)/g,'[電話番号等]').replace(/(?<!\d)\d{8,}(?!\d)/g,'[番号]')}
function refreshPrompt(){const type=$('#m-promptType')?.value||ui.modal?.promptType||'daily',period=$('#m-promptPeriod')?.value||ui.modal?.promptPeriod||'day',mask=$('#prompt-mask')?.checked??true;const t=makePrompt(type,period);if($('#prompt-text'))$('#prompt-text').value=mask?maskSensitive(t):t;if($('#prompt-safety'))$('#prompt-safety').checked=false;if($('#copy-prompt-btn'))$('#copy-prompt-btn').disabled=true}
async function copyText(value){if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(value);return true}catch(e){/* older browser or denied */}}const field=$('#prompt-text');if(!field)return false;field.focus();field.select();try{return document.execCommand('copy')}catch(e){return false}}
function toB64(arr){let result='';const batch=0x8000;for(let i=0;i<arr.length;i+=batch)result+=String.fromCharCode(...arr.subarray(i,i+batch));return btoa(result)}
function fromB64(s){const str=atob(s),out=new Uint8Array(str.length);for(let i=0;i<str.length;i++)out[i]=str.charCodeAt(i);return out}
async function backupEncrypt(pass){if(!crypto.subtle)throw new Error('暗号化機能に対応していません。HTTPSまたはlocalhostで開いてください。');const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),enc=new TextEncoder();const material=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:250000},material,{name:'AES-GCM',length:256},false,['encrypt']);const plain=enc.encode(JSON.stringify(data));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain);return JSON.stringify({format:'gyomu-research-encrypted-backup',version:1,kdf:'PBKDF2-SHA256',iterations:250000,cipher:'AES-256-GCM',salt:toB64(salt),iv:toB64(iv),payload:toB64(new Uint8Array(encrypted))})}
async function backupDecrypt(raw,pass){if(!crypto.subtle)throw new Error('復元機能を利用できません。HTTPSまたはlocalhostで開いてください。');const json=JSON.parse(raw);if(json.format!=='gyomu-research-encrypted-backup'||json.version!==1||json.iterations!==250000||json.cipher!=='AES-256-GCM')throw new Error('対応していないバックアップ形式です。');const salt=fromB64(json.salt),iv=fromB64(json.iv),payload=fromB64(json.payload);if(salt.length!==16||iv.length!==12)throw new Error('バックアップ形式が正しくありません。');const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:250000},material,{name:'AES-GCM',length:256},false,['decrypt']);const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,payload);const parsed=JSON.parse(new TextDecoder().decode(clear));if(!validateState(parsed))throw new Error('バックアップの内容を確認できませんでした。');return parsed}
// The iOS Files picker may label .brlab as an unknown type. Do not filter by MIME/extension.
// Verify the encrypted backup header and authentication tag before accepting its contents.
function readBackupFile(file){
 if(typeof file.text==='function')return file.text();
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result||''));
  reader.onerror=()=>reject(reader.error||new Error('ファイルを読み込めませんでした'));
  reader.readAsText(file,'UTF-8');
 });
}
function downloadFile(content,filename){const url=URL.createObjectURL(new Blob([content],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)}
function duplicateGoal(id){const original=goalById(id);if(!original)return;const clone={...original,id:uid(),title:original.title+'（複製）',createdAt:isoNow(),archivedAt:null,dueDate:''};data.goals.push(clone);const olds=goalTasks(id),map={};olds.forEach(t=>map[t.id]=uid());olds.forEach(t=>{data.tasks.push({...t,id:map[t.id],goalId:clone.id,parentId:t.parentId?map[t.parentId]:null,status:'todo',completedAt:null,plannedDate:'',dueDate:'',createdAt:isoNow()})});ui.activeGroup=clone.groupId||'all';ui.activeGoal=clone.id;ui.todoView='tree';persist();render();toast('達成済みの手順を新しい目標に複製しました')}
function saveForm(form){const m=ui.modal,v=Object.fromEntries(new FormData(form).entries());const trim=k=>String(v[k]||'').trim();let id=m?.id;
if(!m)return;
if(m.type==='group'){if(!trim('name')){toast('グループ名を入力してください');return}if(id){const g=data.groups.find(x=>x.id===id);if(g){g.name=trim('name');g.dueDate=trim('dueDate')}}else{const g={id:uid(),name:trim('name'),dueDate:trim('dueDate'),createdAt:isoNow()};data.groups.push(g);ui.activeGroup=g.id}}
if(m.type==='goal'){if(!trim('title')){toast('目標を入力してください');return}let g=id?goalById(id):null;if(!g){g={id:uid(),createdAt:isoNow(),archivedAt:null};data.goals.push(g)}g.title=trim('title');g.groupId=trim('groupId');g.description=trim('description');g.doneCriteria=trim('doneCriteria');g.dueDate=trim('dueDate');ui.activeGoal=g.id;ui.activeGroup='all';ui.todoView='tree'}
if(m.type==='task'){if(!trim('title')){toast('TODO名を入力してください');return}let t=id?taskById(id):null;const goalId=t?.goalId||m.goalId;if(!goalById(goalId)){toast('目標が見つかりません');return}if(!t){t={id:uid(),goalId,parentId:m.parentId||null,createdAt:isoNow(),completedAt:null};data.tasks.push(t)}const oldStatus=t.status;t.title=trim('title');t.description=trim('description');t.doneCriteria=trim('doneCriteria');t.trigger=trim('trigger');t.availability=trim('availability')||'ready';t.plannedDate=trim('plannedDate');t.dueDate=trim('dueDate');t.status=trim('status')||'todo';if(t.status==='done'){if(oldStatus!=='done')descendantIds(t.id).forEach(tid=>{const node=taskById(tid);node.status='done';node.completedAt=isoNow()});else t.completedAt=t.completedAt||isoNow()}else if(oldStatus==='done'&&t.status!=='done'){descendantIds(t.id).forEach(tid=>{const node=taskById(tid);node.status='todo';node.completedAt=null})}syncParentStatuses(goalId);ui.activeGoal=goalId}
if(m.type==='equipment'){if(!trim('title')){toast('装備名を入力してください');return}const list=ensureCommuteState().equipment;let x=id?list.find(x=>x.id===id):null;if(!x){x={id:uid(),createdAt:isoNow()};list.push(x)}x.title=trim('title');x.category=EQUIPMENT_CATEGORIES.includes(trim('category'))?trim('category'):'持ち物';ui.commuteChecked.delete(x.id)}
if(m.type==='contact'){if(!trim('name')||!trim('phone')){toast('名前と電話番号を入力してください');return}const phone=trim('phone');if(!/^[+0-9０-９()（）\-ー－\s]{5,30}$/.test(phone)||phone.replace(/\D/g,'').length<5){toast('電話番号を確認してください');return}const list=ensureCommuteState().contacts;let c=id?list.find(x=>x.id===id):null;if(!c){c={id:uid(),createdAt:isoNow()};list.push(c)}c.name=trim('name');c.phone=phone;c.description=trim('description')}
if(m.type==='note'){if(!trim('title')){toast('タイトルを入力してください');return}let n=id?data.notes.find(x=>x.id===id):null;if(!n){n={id:uid(),createdAt:isoNow()};data.notes.push(n)}for(const k of ['kind','date','title','details','action','cause','result','nextStep','status','tags'])n[k]=trim(k);n.updatedAt=isoNow()}
hideModal();persist();render();toast('保存しました')}
async function submitForm(form){const type=ui.modal?.type;if(type==='backup'){const pw=form.elements.password.value,again=form.elements.passwordAgain.value;if(pw.length<12){toast('パスワードは12文字以上にしてください');return}if(pw!==again){toast('確認用パスワードが一致しません');return}try{const file=await backupEncrypt(pw);downloadFile(file,`業務研究室-暗号化バックアップ-${today()}.brlab`);hideModal();toast('暗号化バックアップを保存しました')}catch(e){console.error(e);toast('バックアップに失敗しました：'+e.message)}return}
if(type==='restore'){
 const file=form.elements.file.files?.[0],pass=form.elements.password.value;
 if(!file){toast('バックアップファイルを選択してください');return}
 if(file.size>15*1024*1024){toast('15MB以下のファイルを選択してください');return}
 try{
  const raw=await readBackupFile(file);
  let header;
  try{header=JSON.parse(raw)}catch(_){throw new Error('業務研究室の暗号化バックアップファイルを選んでください。')}
  if(header?.format!=='gyomu-research-encrypted-backup')throw new Error('業務研究室の暗号化バックアップファイルを選んでください。');
  let recovered;
  try{recovered=await backupDecrypt(raw,pass)}catch(e){
   if(e?.name==='OperationError')throw new Error('パスワードが異なるか、バックアップが破損しています。');
   throw e;
  }
  if(!confirm(`バックアップの目標 ${recovered.goals.length}件、研究メモ ${recovered.notes.length}件を読み込み、現在のデータをすべて置き換えます。よろしいですか？`))return;
  data=recovered;ensureCommuteState();ui.commuteChecked.clear();ui.activeGoal=null;ui.activeGroup='all';ui.day=today();
  await persist();hideModal();render();toast('復元しました');
 }catch(e){console.error(e);toast('復元できませんでした：'+(e.message||'ファイルやパスワードをご確認ください。'))}
 return
}
saveForm(form)}
document.addEventListener('submit',e=>{
 if(e.target.id==='commute-form'){
  e.preventDefault();if(!isDate(ui.commuteDay)){toast('通勤の日付を確認してください');return}
  const vals=Object.fromEntries(new FormData(e.target).entries()),valid=(key,opts)=>opts.some(x=>x[0]===vals[key])?vals[key]:'';
  if(!['weather','crowding','buffer','transport'].some(k=>String(vals[k]||''))&&!String(vals.memo||'').trim()){toast('天気や混雑などを1項目以上入力してください');return}
  ensureCommuteState().entries[ui.commuteDay]={transport:valid('transport',TRANSPORT_OPTIONS),weather:valid('weather',WEATHER_OPTIONS),crowding:valid('crowding',CROWD_OPTIONS),buffer:valid('buffer',BUFFER_OPTIONS),memo:String(vals.memo||'').trim().slice(0,3000),updatedAt:isoNow()};
  persist();render();toast('通勤記録を保存しました');return;
 }
 if(e.target.id!=='modal-form')return;e.preventDefault();submitForm(e.target)
});
document.addEventListener('click',async e=>{
 const el=e.target.closest('[data-action]');if(!el)return;const action=el.dataset.action,id=el.dataset.id;
 if(action==='close-outside'){if(e.target===el)hideModal();return}
 if(action==='close-modal'){hideModal();return}
 if(action==='navigate'){changePage(el.dataset.page);return}
 if(action==='navigate-daily'){ui.day=stepDay(today(),-1);changePage('daily');return}
 if(action==='navigate-todos'){changePage('todos');return}
 if(action==='navigate-research'){changePage('research');return}
 if(action==='navigate-exec'){ui.todoView='list';ui.execFilter='today';changePage('todos');return}
 if(action==='day-step'){if(ui.page==='home'){ui.day=stepDay(today(),Number(el.dataset.step));changePage('daily')}else{ui.day=stepDay(ui.day,Number(el.dataset.step));render()}return}
 if(action==='day-today'){ui.day=today();if(ui.page==='home')changePage('daily');else render();return}
 if(action==='new-group'){showModal('group');return}
 if(action==='edit-group'){showModal('group',{id});return}
 if(action==='new-goal'){showModal('goal');return}
 if(action==='edit-goal'){showModal('goal',{id});return}
 if(action==='new-task'){showModal('task',{goalId:el.dataset.goal,parentId:el.dataset.parent||null});return}
 if(action==='edit-task'){showModal('task',{id});return}
 if(action==='commute-tab'){ui.commuteView=el.dataset.view;render();return}
 if(action==='commute-today-log'){ui.commuteDay=today();ui.commuteView='log';render();return}
 if(action==='commute-date-today'){ui.commuteDay=today();render();return}
 if(action==='commute-step'){ui.commuteDay=stepDay(ui.commuteDay,Number(el.dataset.step));render();return}
 if(action==='commute-jump'){ui.commuteDay=el.dataset.day;ui.commuteView='log';render();return}
 if(action==='new-equipment'){showModal('equipment');return}
 if(action==='edit-equipment'){showModal('equipment',{id});return}
 if(action==='new-contact'){showModal('contact');return}
 if(action==='edit-contact'){showModal('contact',{id});return}
 if(action==='equip-check'){
  if(ui.commuteChecked.has(id))ui.commuteChecked.delete(id);else ui.commuteChecked.add(id);
  el.classList.toggle('checked',ui.commuteChecked.has(id));el.setAttribute('aria-checked',String(ui.commuteChecked.has(id)));
  el.nextElementSibling?.classList.toggle('done-text',ui.commuteChecked.has(id));const count=$('#equip-count');if(count)count.textContent=`${ui.commuteChecked.size} / ${ensureCommuteState().equipment.length} 件確認`;
  return;
 }
 if(action==='equip-reset'){ui.commuteChecked.clear();render();return}
 if(action==='delete-commute-log'){if(confirm('この日の通勤記録を削除しますか？')){delete ensureCommuteState().entries[el.dataset.day];persist();render();toast('通勤記録を削除しました')}return}
 if(action==='new-note'){showModal('note',{kind:el.dataset.kind||'insight'});return}
 if(action==='edit-note'){showModal('note',{id});return}
 if(action==='filter-group'){ui.activeGroup=id;ui.activeGoal=null;render();return}
 if(action==='focus-goal'){ui.activeGoal=id;ui.activeGroup='all';ui.todoView='tree';changePage('todos');return}
 if(action==='todo-tab'){ui.todoView=el.dataset.view;render();return}
 if(action==='calendar-step'){const [year,month]=ui.calendarMonth.split('-').map(Number);const d=new Date(year,month-1+Number(el.dataset.step),1,12);ui.calendarMonth=dstr(d).slice(0,7);ui.calendarSelected=ui.calendarMonth+'-01';render();return}
 if(action==='calendar-today'){ui.calendarMonth=today().slice(0,7);ui.calendarSelected=today();render();return}
 if(action==='calendar-day'){ui.calendarSelected=el.dataset.day;render();return}
 if(action==='calendar-jump'){ui.calendarSelected=el.dataset.day;ui.calendarMonth=ui.calendarSelected.slice(0,7);render();return}
 if(action==='period'){ui.reflectionPeriod=el.dataset.period;render();return}
 if(action==='toggle-task'){const t=taskById(id);if(t)setTaskDone(id,t.status!=='done');return}
 if(action==='plan-task'){const t=taskById(id);if(t){t.plannedDate=t.plannedDate===today()?'':today();persist();render();toast(t.plannedDate?'今日のTODOに追加しました':'今日のTODOから外しました')}return}
 if(action==='collapse'){if(ui.collapsed.has(id))ui.collapsed.delete(id);else ui.collapsed.add(id);render();return}
 if(action==='rate'){const d=dayData(ui.day),value=Number(el.dataset.value),key=el.dataset.key;d.ratings[key]=d.ratings[key]===value?null:value;d.updatedAt=isoNow();scheduleSave();render();return}
 if(action==='open-prompt'){showModal('prompt',{promptType:el.dataset.type||'daily',promptPeriod:el.dataset.type==='review'?ui.reflectionPeriod:'day'});return}
 if(action==='refresh-prompt'){refreshPrompt();toast('記録から文章を再生成しました');return}
 if(action==='copy-prompt'){if(!$('#prompt-safety')?.checked){toast('機密情報の確認欄にチェックしてください');return}const ok=await copyText($('#prompt-text').value);toast(ok?'クリップボードにコピーしました。貼り付ける前にも確認してください。':'コピーできませんでした。文章欄から手動でコピーしてください。');return}
 if(action==='check-app-update'){checkAppUpdate();return}
 if(action==='apply-app-update'){applyAppUpdate();return}
 if(action==='backup'){showModal('backup');return}
 if(action==='restore'){showModal('restore');return}
 if(action==='delete-group'){if(confirm('グループを削除しますか？所属する目標は「未分類」に移動します。')){data.groups=data.groups.filter(g=>g.id!==id);data.goals.forEach(g=>{if(g.groupId===id)g.groupId=''});ui.activeGroup='all';hideModal();persist();render();toast('グループを削除しました')}return}
 if(action==='delete-goal'){if(confirm('この目標と配下のすべてのTODOを削除しますか？この操作は取り消せません。')){data.goals=data.goals.filter(g=>g.id!==id);data.tasks=data.tasks.filter(t=>t.goalId!==id);ui.activeGoal=null;hideModal();persist();render();toast('目標を削除しました')}return}
 if(action==='delete-task'){if(confirm('このTODOと配下のすべての子TODOを削除しますか？')){const ids=new Set(descendantIds(id));const t=taskById(id);data.tasks=data.tasks.filter(x=>!ids.has(x.id));syncParentStatuses(t.goalId);hideModal();persist();render();toast('TODOを削除しました')}return}
 if(action==='delete-equipment'){if(confirm('この装備を削除しますか？')){data.commute.equipment=data.commute.equipment.filter(x=>x.id!==id);ui.commuteChecked.delete(id);hideModal();persist();render();toast('装備を削除しました')}return}
 if(action==='delete-contact'){if(confirm('この連絡先を削除しますか？')){data.commute.contacts=data.commute.contacts.filter(x=>x.id!==id);hideModal();persist();render();toast('連絡先を削除しました')}return}
 if(action==='delete-note'){if(confirm('この研究メモを削除しますか？')){data.notes=data.notes.filter(n=>n.id!==id);hideModal();persist();render();toast('研究メモを削除しました')}return}
 if(action==='duplicate-goal'){duplicateGoal(id);return}
 if(action==='archive-goal'){const g=goalById(id);if(g){g.archivedAt=g.archivedAt?null:isoNow();persist();render();toast(g.archivedAt?'研究成果として保存しました':'研究成果から戻しました')}return}
 if(action==='clear-data'){const val=prompt('すべてのデータを削除するには「削除」と入力してください。');if(val!=='削除')return;if(!confirm('本当にすべての記録を削除しますか？暗号化バックアップがない場合、復元できません。'))return;data=newState();ui.activeGroup='all';ui.activeGoal=null;ui.day=today();await persist();render();toast('データを初期化しました');return}
});
document.addEventListener('input',e=>{const el=e.target;
 if(el.dataset.daily){const d=dayData(ui.day);d[el.dataset.daily]=el.value;d.updatedAt=isoNow();scheduleSave();const status=$('#autosave-label');if(status){status.textContent='保存中…';clearTimeout(status._timer);status._timer=setTimeout(()=>{status.textContent='自動保存しました'},800)}return}
 if(el.dataset.search==='research'){ui.researchQuery=el.value;clearTimeout(ui.searchTimer);const pos=el.selectionStart;ui.searchTimer=setTimeout(()=>{render();const input=$('#research-search');if(input){input.focus();input.setSelectionRange(pos,pos)}},250);return}
 if(el.id==='prompt-safety'){const btn=$('#copy-prompt-btn');if(btn)btn.disabled=!el.checked;return}
 if(el.id==='prompt-mask'){refreshPrompt();return}
});
document.addEventListener('change',e=>{const el=e.target;
 if(el.id==='restore-file'){
  const label=$('#restore-file-selected');
  if(label)label.textContent=el.files?.[0]?'選択中：'+el.files[0].name:'ファイルが選択されていません';
  return;
 }
 if(el.dataset.change==='commute-date'){if(isDate(el.value)){ui.commuteDay=el.value;render()}else toast('日付が正しくありません');return}
 if(el.dataset.change==='exec-filter'){ui.execFilter=el.value;render();return}
 if(el.dataset.change==='note-filter'){ui.researchType=el.value;render();return}
 if(el.id==='m-promptType'||el.id==='m-promptPeriod'){refreshPrompt();return}
 if(el.id==='prompt-safety'){const btn=$('#copy-prompt-btn');if(btn)btn.disabled=!el.checked;return}
 if(el.id==='prompt-mask'){refreshPrompt();return}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&ui.modal)hideModal()});
window.addEventListener('pagehide',()=>{if(saveTimer){clearTimeout(saveTimer);saveTimer=null;persist()}});
window.addEventListener('online',showPwaInfo);
window.addEventListener('offline',showPwaInfo);
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    pwa.ready=true;
    showPwaInfo();
    if(pwa.updating){pwa.updating=false;location.reload()}
  });
}
initialize();
