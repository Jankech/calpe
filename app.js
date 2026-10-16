(() => {
'use strict';

const CFG = window.CALPE_CONFIG || {};
const $ = id => document.getElementById(id);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const icon = (name, cls='icon') => `<svg class="${cls}"><use href="#i-${name}"></use></svg>`;
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
const sum = a => a.reduce((x,y)=>x+y,0);
const round = (n,d=0) => Number(n||0).toLocaleString('sk-SK',{maximumFractionDigits:d,minimumFractionDigits:d});
const eur = cents => (Number(cents||0)/100).toLocaleString('sk-SK',{style:'currency',currency:'EUR'});
const todayISO = () => new Date().toISOString().slice(0,10);
const nowHHMM = () => new Date().toTimeString().slice(0,5);
const dateLabel = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('sk-SK',{day:'numeric',month:'short'}) : '—';
const dateLong = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('sk-SK',{weekday:'long',day:'numeric',month:'long'}) : '—';
const initials = name => String(name||'?').trim().split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();
const slugify = s => String(s||'user').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const participant = id => S.participants.find(p=>String(p.id)===String(id));
const category = id => S.categories.find(c=>String(c.id)===String(id));
const currency = code => S.currencies.find(c=>c.code===code);
const safeJSON = v => (v && typeof v === 'object') ? v : {};
const hmToMinutes = hm => { const m=/^(\d{1,2}):(\d{2})$/.exec(String(hm||'')); return m ? Number(m[1])*60+Number(m[2]) : 0; };
const minutesToHM = m => `${Math.floor(Number(m||0)/60)}:${String(Number(m||0)%60).padStart(2,'0')}`;
const addDays = (iso,n) => { const d=new Date(iso+'T12:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
const daysBetween = (a,b) => a&&b ? Math.max(0,Math.round((new Date(b+'T12:00:00')-new Date(a+'T12:00:00'))/86400000)) : 0;
const normalizeIBAN = v => String(v||'').toUpperCase().replace(/\s+/g,'');
function validIBAN(v){
  const iban=normalizeIBAN(v); if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged=iban.slice(4)+iban.slice(0,4); let rem=0;
  for(const ch of rearranged){ const part=/\d/.test(ch)?ch:String(ch.charCodeAt(0)-55); for(const d of part) rem=(rem*10+Number(d))%97; }
  return rem===1;
}
function formatIBAN(v){ const x=normalizeIBAN(v); return x.replace(/(.{4})(?=.)/g,'$1 '); }
async function copyText(text,label='Skopírované'){
  try{await navigator.clipboard.writeText(text);}catch(_){const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}
  toast(label);
}

const S = {
  client:null, session:null, tripId:null, trip:null, me:null,
  participants:[], currencies:[], categories:[], expenses:[], payments:[], bathroom:[], rides:[], rideEvents:[], drinks:[],
  allRides:[], allRideEvents:[], allDrinks:[],
  activeView:'expenses', cupTab:'ranking', badgeMode:'catalog', newRideEvents:[], editRideEvents:[], editRideId:null, rideEditing:false,
  expenseEditId:null, lastLoad:null, badgeCache:null, avatarUrls:{}, tripCoverUrl:null, mediaLoadedAt:0, mediaSignature:''
};

const MEDIA_BUCKET='calpe-media';
const DEFAULT_SCORE = Object.freeze({
  distance_km_per_point:10,
  elevation_m_per_point:100,
  drink_points:1,
  sprint_first:6,sprint_second:4,sprint_third:2,
  hill_first:6,hill_second:4,hill_third:2,
  crash_points:10,puncture_points:5,mechanical_points:5,
  sober_day_points:2,sober_trip_points:20
});
const scoreSettings = () => ({...DEFAULT_SCORE,...safeJSON(S.trip?.score_settings)});
function applyVisibilityFilters(){
  const show=!!S.trip?.show_test_data;
  S.rides=(S.allRides||[]).filter(x=>show||!x.is_test);
  const visible=new Set(S.rides.map(x=>x.id));
  S.rideEvents=(S.allRideEvents||[]).filter(x=>visible.has(x.ride_id));
  S.drinks=(S.allDrinks||[]).filter(x=>show||!x.is_test);
}

const avatarPath = p => p && S.tripId ? `trips/${S.tripId}/avatars/${p.id}/avatar.webp` : '';
const tripCoverPath = () => S.tripId ? `trips/${S.tripId}/cover.webp` : '';

function avatarHTML(p,size='m'){
  if(!p) return `<span class="avatar ${size}"><span>?</span></span>`;
  const src=S.avatarUrls[p.id]||`assets/users/${slugify(p.name)}.webp`;
  return `<span class="avatar ${size}" title="${esc(p.name)}"><span>${esc(initials(p.name))}</span><img data-avatar src="${esc(src)}" alt=""></span>`;
}
function hydrateAvatars(root=document){
  $$('img[data-avatar]',root).forEach(img=>{
    if(img.dataset.bound) return; img.dataset.bound='1';
    img.addEventListener('load',()=>img.classList.add('loaded'),{once:true});
    img.addEventListener('error',()=>img.remove(),{once:true});
    if(img.complete && img.naturalWidth) img.classList.add('loaded');
  });
}
async function refreshMediaUrls(force=false){
  if(!S.client||!S.tripId||!S.participants.length) return;
  const sig=S.tripId+'|'+S.participants.map(p=>p.id).sort().join('|');
  if(!force && S.mediaSignature===sig && Date.now()-S.mediaLoadedAt<45*60*1000) return;
  const paths=[...S.participants.map(avatarPath),tripCoverPath()];
  try{
    const {data,error}=await S.client.storage.from(MEDIA_BUCKET).createSignedUrls(paths,60*60*2);
    if(error) throw error;
    const byPath={}; (data||[]).forEach(x=>{if(x?.signedUrl)byPath[x.path]=x.signedUrl;});
    S.avatarUrls={}; S.participants.forEach(p=>{const u=byPath[avatarPath(p)];if(u)S.avatarUrls[p.id]=u;});
    S.tripCoverUrl=byPath[tripCoverPath()]||null;
    S.mediaLoadedAt=Date.now(); S.mediaSignature=sig;
  }catch(err){
    console.warn('Media storage unavailable, using local fallbacks.',err);
    S.avatarUrls={}; S.tripCoverUrl=null; S.mediaLoadedAt=Date.now(); S.mediaSignature=sig;
  }
  applyTripCover();
}
function applyTripCover(){
  const el=document.querySelector('.hero-more');
  if(!el)return;
  el.style.backgroundImage=S.tripCoverUrl?`url("${S.tripCoverUrl}")`:'';
}
async function imageToBlob(file,width,height,quality=.86){
  if(!file) throw new Error('Vyber obrázok.');
  if(!String(file.type||'').startsWith('image/')) throw new Error('Súbor musí byť obrázok.');
  if(file.size>12*1024*1024) throw new Error('Obrázok je príliš veľký. Maximum je 12 MB.');
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('Obrázok sa nepodarilo načítať.'));i.src=url;});
    const sw=img.naturalWidth,sh=img.naturalHeight,target=width/height,source=sw/sh;
    let sx=0,sy=0,cw=sw,ch=sh;
    if(source>target){cw=sh*target;sx=(sw-cw)/2;}else{ch=sw/target;sy=(sh-ch)/2;}
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{alpha:false});ctx.drawImage(img,sx,sy,cw,ch,0,0,width,height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));
    if(!blob) throw new Error('Obrázok sa nepodarilo spracovať.');
    return blob;
  }finally{URL.revokeObjectURL(url);}
}
async function uploadMedia(path,blob){
  const {error}=await S.client.storage.from(MEDIA_BUCKET).upload(path,blob,{upsert:true,contentType:blob.type||'image/webp',cacheControl:'60'});
  if(error)throw error;
  S.mediaLoadedAt=0;
  await refreshMediaUrls(true);
}
async function uploadMyAvatar(file){
  if(!S.me)return;
  try{
    toast('Spracúvam fotku…');
    const blob=await imageToBlob(file,512,512,.88);
    await uploadMedia(avatarPath(S.me),blob);
    renderAll(); toast('Profilová fotka uložená.');
  }catch(err){toast(err.message,true);}
}
async function removeMyAvatar(){
  if(!S.me||!confirm('Odstrániť profilovú fotku?'))return;
  try{const{error}=await S.client.storage.from(MEDIA_BUCKET).remove([avatarPath(S.me)]);if(error)throw error;delete S.avatarUrls[S.me.id];S.mediaLoadedAt=0;await refreshMediaUrls(true);renderAll();toast('Profilová fotka odstránená.');}catch(err){toast(err.message,true);}
}
async function uploadTripCover(file){
  try{const blob=await imageToBlob(file,1600,900,.86);await uploadMedia(tripCoverPath(),blob);renderAll();toast('Fotka výpravy uložená.');}catch(err){toast(err.message,true);}
}
async function removeTripCover(){
  if(!confirm('Odstrániť vlastnú fotku výpravy a vrátiť predvolenú?'))return;
  try{const{error}=await S.client.storage.from(MEDIA_BUCKET).remove([tripCoverPath()]);if(error)throw error;S.tripCoverUrl=null;S.mediaLoadedAt=0;await refreshMediaUrls(true);renderAll();toast('Fotka výpravy odstránená.');}catch(err){toast(err.message,true);}
}
function avatarStack(ids,max=4){
  const ps=(ids||[]).map(participant).filter(Boolean); if(!ps.length) return '';
  const shown=ps.slice(0,max); return `<span class="avatar-stack">${shown.map(p=>avatarHTML(p,'s')).join('')}${ps.length>max?`<span class="avatar-more">+${ps.length-max}</span>`:''}</span>`;
}
function toast(msg,error=false){
  const el=$('toast'); if(!el) return; el.textContent=msg; el.className='toast show'+(error?' error':''); clearTimeout(toast.t); toast.t=setTimeout(()=>el.className='toast',2800);
}
function status(msg){ if($('statusText')) $('statusText').textContent=msg; }
function showGate(title,text,actions='',technical=''){
  $('gate').hidden=false; $('app').hidden=true; $('gateTitle').textContent=title; $('gateText').textContent=text; $('gateActions').innerHTML=actions;
  $('gateDetails').hidden=!technical; $('gateTechnical').textContent=technical||'';
}
function hideGate(){ $('gate').hidden=true; $('app').hidden=false; }
function setupGate(){
  showGate('Supabase ešte nie je nastavený','Doplň Project URL a publishable key do config.js. Potom stránku obnov.',`<button class="ghost-btn" id="setupReload">Obnoviť</button>`,'config.js still contains placeholder values.');
  $('setupReload').onclick=()=>location.reload();
}
function errorGate(err){
  const msg=err?.message||String(err||'Unknown error');
  showGate('Nepodarilo sa načítať Calpe','Skontroluj pripojenie a Supabase nastavenie. Ak si už prihlásený, skús načítať dáta znova.',`<button class="retry-btn" id="gateRetry">Skúsiť znova</button><button class="ghost-btn" id="gateLogout">Odhlásiť</button>`,msg);
  $('gateRetry').onclick=()=>bootSession(); $('gateLogout').onclick=()=>S.client?.auth.signOut();
}
function loginGate(){
  showGate('Vitaj v Calpe','Prihlás sa Google účtom, ktorý je pridaný medzi účastníkmi výpravy.',`<button class="google-btn" id="googleLogin">Pokračovať cez Google</button>`);
  $('googleLogin').onclick=signIn;
}
function deniedGate(){
  const email=S.session?.user?.email||'';
  showGate('Tento účet nemá prístup',`Účet ${email} nie je pridaný medzi účastníkmi Calpe 2026. Požiadaj administrátora výpravy, aby pridal túto e-mailovú adresu.`,`<button class="ghost-btn" id="gateLogout">Použiť iný účet</button>`);
  $('gateLogout').onclick=()=>S.client.auth.signOut();
}
async function signIn(){
  const redirectTo = CFG.SITE_URL && !CFG.SITE_URL.includes('YOUR_') ? CFG.SITE_URL : location.origin+location.pathname;
  const {error}=await S.client.auth.signInWithOAuth({provider:'google',options:{redirectTo}}); if(error) errorGate(error);
}

async function init(){
  wireStaticUI();
  if(!window.supabase || !CFG.SUPABASE_URL || !CFG.SUPABASE_PUBLISHABLE_KEY || CFG.SUPABASE_URL.includes('YOUR_') || CFG.SUPABASE_PUBLISHABLE_KEY.includes('YOUR_')){ setupGate(); return; }
  try{
    S.client=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data,error}=await S.client.auth.getSession(); if(error) throw error; S.session=data.session;
    S.client.auth.onAuthStateChange((event,session)=>{ S.session=session; if(event==='SIGNED_OUT') loginGate(); });
    if(!S.session){ loginGate(); return; }
    await bootSession();
  }catch(err){ errorGate(err); }
}

async function bootSession(){
  try{
    showGate('Načítavam výpravu…','Overujem prístup a sťahujem spoločné dáta.','<span class="spinner"></span>');
    const {data,error}=await S.client.rpc('claim_trip_membership',{p_trip_slug:CFG.TRIP_SLUG||'calpe-2026'}); if(error) throw error;
    const claim=Array.isArray(data)?data[0]:data; if(!claim?.trip_id){ deniedGate(); return; }
    S.tripId=claim.trip_id;
    await loadAllData(); hideGate();
  }catch(err){ errorGate(err); }
}
function qcheck(r){ if(r.error) throw r.error; return r.data||[]; }
async function loadAllData(opts={}){
  const quiet=!!opts.quiet; if(!quiet) status('Načítavam…');
  const [tr,p,c,cat,e,pay,b,r,re,d]=await Promise.all([
    S.client.from('trips').select('*').eq('id',S.tripId).single(),
    S.client.from('participants').select('*').eq('trip_id',S.tripId).eq('active',true).order('name'),
    S.client.from('currencies').select('*').eq('trip_id',S.tripId).order('code'),
    S.client.from('categories').select('*').eq('trip_id',S.tripId).order('name'),
    S.client.from('expenses').select('*').eq('trip_id',S.tripId).order('expense_date',{ascending:false}).order('created_at',{ascending:false}),
    S.client.from('payments').select('*').eq('trip_id',S.tripId).order('payment_date',{ascending:false}).order('created_at',{ascending:false}),
    S.client.from('bathroom_bookings').select('*').eq('trip_id',S.tripId).order('booking_date').order('slot'),
    S.client.from('rides').select('*').eq('trip_id',S.tripId).order('ride_date',{ascending:false}).order('created_at',{ascending:false}),
    S.client.from('ride_events').select('*').eq('trip_id',S.tripId).order('sort_order').order('created_at'),
    S.client.from('drinks').select('*').eq('trip_id',S.tripId).order('consumed_at',{ascending:false})
  ]);
  if(tr.error) throw tr.error; S.trip=tr.data; S.participants=qcheck(p); S.currencies=qcheck(c); S.categories=qcheck(cat); S.expenses=qcheck(e); S.payments=qcheck(pay); S.bathroom=qcheck(b); S.allRides=qcheck(r); S.allRideEvents=qcheck(re); S.allDrinks=qcheck(d); applyVisibilityFilters();
  const email=String(S.session?.user?.email||'').toLowerCase(); S.me=S.participants.find(x=>x.user_id===S.session?.user?.id)||S.participants.find(x=>String(x.email).toLowerCase()===email)||null;
  await refreshMediaUrls();
  S.lastLoad=new Date(); S.badgeCache=null;
  const editing = document.activeElement?.closest?.('form') || document.body.classList.contains('sheet-open');
  if(!quiet || !editing) renderAll();
  status('Aktualizované '+S.lastLoad.toLocaleTimeString('sk-SK',{hour:'2-digit',minute:'2-digit'}));
}

function wireStaticUI(){
  $$('#bottomNav button').forEach(b=>b.onclick=()=>{navigate(b.dataset.view); if(b.dataset.cupTab) switchTab('cup',b.dataset.cupTab);});
  $$('[data-tabs]').forEach(nav=>nav.addEventListener('click',e=>{ const b=e.target.closest('button[data-tab]'); if(!b)return; switchTab(nav.dataset.tabs,b.dataset.tab); }));
  $('refreshBtn').onclick=()=>loadAllData().catch(err=>toast(err.message,true));
  $('sheetBackdrop').onclick=closeSheets;
  $$('[data-close-sheet]').forEach(b=>b.onclick=closeSheets);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeSheets(); });
  $('meButton').onclick=()=>{navigate('more'); const panels=$$('#settingsSections details'); if(panels.length){panels.forEach(x=>x.open=false); panels[panels.length-1].open=true; panels[panels.length-1].scrollIntoView({behavior:'smooth',block:'start'});} };
  $('expenseForm').addEventListener('submit',saveNewExpense);
  $('paymentForm').addEventListener('submit',savePayment);
  $('payTo').addEventListener('change',renderPayeeIbanHint);
  $('rideForm').addEventListener('submit',saveNewRide);
  $('drinkForm').addEventListener('submit',saveDrink);
  $('expSplit').addEventListener('change',()=>renderCustomWeights('expCustom','expParticipants',{}));
  $('expCategory').addEventListener('change',()=>{ const c=category($('expCategory').value); if(c) $('expSplit').value=c.default_split_method; renderCustomWeights('expCustom','expParticipants',{}); });
  $('expParticipants').addEventListener('change',()=>renderCustomWeights('expCustom','expParticipants',readWeightInputs('expCustom')));
  $('rideParticipants').addEventListener('change',()=>renderEventEditor('newRideEvents',S.newRideEvents,selectedIds('rideParticipants'),'new'));
  $$('[data-add-event]').forEach(b=>b.addEventListener('click',()=>addRideEvent(b.dataset.addEvent,'new')));
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden && S.tripId && !document.querySelector('details.form-accordion[open]') && !document.body.classList.contains('sheet-open')) loadAllData({quiet:true}).catch(()=>{}); });
  setInterval(()=>{ if(!document.hidden && S.tripId && !document.querySelector('details.form-accordion[open]') && !document.body.classList.contains('sheet-open')) loadAllData({quiet:true}).catch(()=>{}); },45000);
}
function refreshBottomNav(){
  if(!$('navBathroom')||!$('navBadges'))return;
  const showBath=!!S.trip?.show_bathroom;
  $('navBathroom').hidden=!showBath; $('navBadges').hidden=showBath; if($('view-bathroom')) $('view-bathroom').hidden=!showBath;
  if(!showBath && S.activeView==='bathroom') navigate('cup');
  $$('#bottomNav button').forEach(x=>{const badgeActive=x.id==='navBadges'&&S.activeView==='cup'&&S.cupTab==='badges';const normalActive=x.id!=='navBadges'&&x.dataset.view===S.activeView&&!(x.dataset.view==='cup'&&S.cupTab==='badges'&&!showBath);x.classList.toggle('active',badgeActive||normalActive);});
}
function updateHero(){
  let meta={expenses:['Výdavky','Spoločné náklady bez excelového utrpenia.'],bathroom:['Kúpeľňa','Ráno má plán. A plán má dve kúpeľne.'],cup:['Calpe Cup','Kilometre, kopce, pódiá, mishapy a legendy.'],more:['Viac','Pobyt, ľudia, administrácia a účet.']}[S.activeView]||['Calpe',''];
  if(S.activeView==='cup'&&S.cupTab==='badges')meta=['Odznaky','Príbeh výpravy v malých víťazstvách a katastrofách.'];
  $('heroTitle').textContent=meta[0]; $('heroSubtitle').textContent=meta[1];
}
function navigate(view){
  S.activeView=view; document.body.dataset.view=view;
  $$('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${view}`));
  refreshBottomNav(); updateHero(); window.scrollTo({top:0,behavior:'smooth'});
}
function switchTab(group,tab){
  const nav=document.querySelector(`[data-tabs="${group}"]`); if(!nav)return; $$('button[data-tab]',nav).forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  const scope=group==='expenses'?$('view-expenses'):$('view-cup'); $$('.tab-pane',scope).forEach(p=>p.classList.toggle('active',p.id===`tab-${tab}`));
  if(group==='cup'){S.cupTab=tab;refreshBottomNav();updateHero();}
}

function renderAll(){
  refreshBottomNav(); renderHeroUser(); renderFormOptions(); renderExpenses(); renderPayments(); renderSettlement(); if(S.trip?.show_bathroom)renderBathroom(); renderCup(); renderSettings(); hydrateAvatars();
}
function renderHeroUser(){ $('meButton').innerHTML=avatarHTML(S.me,'m'); hydrateAvatars($('meButton')); }
function selectOptions(ps,selected='',blank=false){ return (blank?`<option value="">— voľno —</option>`:'')+ps.map(p=>`<option value="${p.id}" ${String(p.id)===String(selected)?'selected':''}>${esc(p.name)}</option>`).join(''); }
function currencyOptions(selected='EUR'){ return S.currencies.map(c=>`<option value="${esc(c.code)}" ${c.code===selected?'selected':''}>${esc(c.code)}</option>`).join(''); }
function categoryOptions(selected=''){ return S.categories.map(c=>`<option value="${c.id}" ${String(c.id)===String(selected)?'selected':''}>${esc(c.name)}</option>`).join(''); }
function choiceChips(ids=[],name='p'){ const set=new Set((ids||[]).map(String)); return S.participants.map(p=>`<label class="choice-chip"><input type="checkbox" name="${name}" value="${p.id}" ${set.has(String(p.id))?'checked':''}><span>${avatarHTML(p,'s')}${esc(p.name)}</span></label>`).join(''); }
function selectedIds(containerId){ return $$(`#${containerId} input[type=checkbox]:checked`).map(x=>x.value); }
function readWeightInputs(containerId){ const o={}; $$(`#${containerId} input[data-person]`).forEach(i=>{ if(i.value) o[i.dataset.person]=Number(i.value); }); return o; }
function renderCustomWeights(containerId,chipContainerId,weights={}){
  const el=$(containerId); const split=containerId==='expCustom'?$('expSplit').value:$('editExpSplit')?.value;
  const ids=selectedIds(chipContainerId); if(split!=='custom'){el.classList.remove('show'); el.innerHTML=''; return;}
  el.classList.add('show'); el.innerHTML=ids.map(id=>{const p=participant(id);return `<label>${esc(p?.name||'')}<input data-person="${id}" type="number" step="0.01" min="0" value="${esc(weights[id]??'')}"></label>`;}).join('');
}
function renderFormOptions(){
  const cfg=scoreSettings(); if($('drinkRuleHint')) $('drinkRuleHint').textContent=`Každý drink = ${cfg.drink_points} bod${cfg.drink_points===1?'':'y'}. Sober day = +${cfg.sober_day_points}; celý trip sober = +${cfg.sober_trip_points}.`;
  const all=S.participants.map(p=>p.id); const me=S.me?.id||S.participants[0]?.id||''; const firstCat=(S.categories.find(c=>c.name==='Strava')||S.categories[0])?.id||'';
  $('expCategory').innerHTML=categoryOptions(firstCat); $('expCurrency').innerHTML=currencyOptions('EUR'); $('expPaidBy').innerHTML=selectOptions(S.participants,me); $('expParticipants').innerHTML=choiceChips(all,'expP');
  $('payCurrency').innerHTML=currencyOptions('EUR'); $('payFrom').innerHTML=selectOptions(S.participants,me); $('payTo').innerHTML=selectOptions(S.participants,S.participants.find(p=>p.id!==me)?.id||me);
  $('rideParticipants').innerHTML=choiceChips(all,'rideP'); $('drinkPerson').innerHTML=selectOptions(S.participants,me);
  if(!$('expDate').value) $('expDate').value=todayISO(); if(!$('payDate').value) $('payDate').value=todayISO(); if(!$('rideDate').value) $('rideDate').value=todayISO(); if(!$('drinkDate').value) $('drinkDate').value=todayISO(); if(!$('drinkTime').value) $('drinkTime').value=nowHHMM();
  const c=category($('expCategory').value); if(c) $('expSplit').value=c.default_split_method; renderCustomWeights('expCustom','expParticipants',{}); renderEventEditor('newRideEvents',S.newRideEvents,selectedIds('rideParticipants'),'new'); renderPayeeIbanHint();
}

/* ---------- Expenses ---------- */
function categoryIcon(c){ return c?.icon_key||'other'; }
function categoryClass(key){ return ['food','drink','bed','bike','plane','car','cart'].includes(key)?key:'other'; }
function rate(code){ return Number(currency(code)?.rate_to_eur||1); }
function centsEUR(amount,code){ return Math.round(Number(amount||0)*rate(code)*100); }
function nightsFor(p){ return daysBetween(p?.arrival_date,p?.departure_date); }
function allocate(total,weights){ const s=sum(weights); if(s<=0) return weights.map(()=>0); const raw=weights.map(w=>total*w/s), out=raw.map(Math.floor); let rem=total-sum(out); raw.map((r,i)=>[r-Math.floor(r),i]).sort((a,b)=>b[0]-a[0]).forEach(([,i])=>{if(rem>0){out[i]++;rem--;}}); return out; }
function expenseShares(exp){
  const ids=exp.participant_ids||[]; let weights;
  if(exp.split_method==='nights'){weights=ids.map(id=>nightsFor(participant(id))); if(weights.every(x=>x===0)) weights=ids.map(()=>1);}
  else if(exp.split_method==='custom'){const w=safeJSON(exp.custom_weights);weights=ids.map(id=>Number(w[id])||0);if(weights.every(x=>x===0))weights=ids.map(()=>1);} else weights=ids.map(()=>1);
  const parts=allocate(centsEUR(exp.amount,exp.currency_code),weights); const out={}; ids.forEach((id,i)=>out[id]=parts[i]); return out;
}
async function saveNewExpense(e){
  e.preventDefault(); try{
    const ids=selectedIds('expParticipants'); const amount=Number($('expAmount').value); if(!(amount>0)||!ids.length) throw new Error('Zadaj sumu a aspoň jedného účastníka.');
    const payload={trip_id:S.tripId,expense_date:$('expDate').value,category_id:$('expCategory').value||null,description:$('expDescription').value.trim(),amount,currency_code:$('expCurrency').value,paid_by:$('expPaidBy').value,participant_ids:ids,split_method:$('expSplit').value,custom_weights:readWeightInputs('expCustom')};
    const {error}=await S.client.from('expenses').insert(payload); if(error) throw error; $('expDescription').value=''; $('expAmount').value=''; $('newExpenseAccordion').open=false; await loadAllData(); toast('Výdavok uložený.');
  }catch(err){toast(err.message,true);}
}
function renderExpenses(){
  $('expenseCount').textContent=`${S.expenses.length} záz.`;
  $('expenseFeed').innerHTML=S.expenses.length?S.expenses.map(x=>{ const c=category(x.category_id),p=participant(x.paid_by),key=categoryIcon(c); const er=centsEUR(x.amount,x.currency_code),conv=x.currency_code!=='EUR'?eur(er):''; return `<button class="feed-row expense-open" data-id="${x.id}"><span class="feed-icon ${categoryClass(key)}">${icon(key)}</span><span class="feed-copy"><b>${esc(x.description||c?.name||'Výdavok')}</b><small>${avatarHTML(p,'s')} ${esc(c?.name||'Iné')} · ${dateLabel(x.expense_date)} · ${x.participant_ids?.length||0} os.</small></span><span class="feed-value">${round(x.amount,2)} ${esc(x.currency_code)}${conv?`<small>${conv}</small>`:''}</span>${icon('chevron','feed-chevron')}</button>`;}).join(''):`<div class="empty">Zatiaľ tu nie sú žiadne výdavky.</div>`;
  $$('.expense-open').forEach(b=>b.onclick=()=>openExpenseSheet(b.dataset.id)); hydrateAvatars($('expenseFeed'));
}
function openExpenseSheet(id){ S.expenseEditId=id; const x=S.expenses.find(e=>e.id===id); if(!x)return; const c=category(x.category_id); $('expenseSheetTitle').textContent=x.description||c?.name||'Výdavok'; $('expenseSheetIcon').innerHTML=icon(categoryIcon(c)); renderExpenseEdit(x); openSheet('expenseSheet'); }
function renderExpenseEdit(x){
  const weights=safeJSON(x.custom_weights); $('expenseEditForm').innerHTML=`
    <div class="form-grid two"><label>Dátum<input type="date" id="editExpDate" value="${esc(x.expense_date)}"></label><label>Kategória<select id="editExpCategory">${categoryOptions(x.category_id)}</select></label></div>
    <label>Popis<input id="editExpDescription" value="${esc(x.description)}"></label>
    <div class="form-grid two"><label>Suma<input type="number" step="0.01" min="0.01" id="editExpAmount" value="${esc(x.amount)}"></label><label>Mena<select id="editExpCurrency">${currencyOptions(x.currency_code)}</select></label></div>
    <label>Zaplatil<select id="editExpPaidBy">${selectOptions(S.participants,x.paid_by)}</select></label>
    <label>Koho sa týka</label><div id="editExpParticipants" class="choice-grid">${choiceChips(x.participant_ids,'editExpP')}</div>
    <label>Spôsob delenia<select id="editExpSplit"><option value="equal" ${x.split_method==='equal'?'selected':''}>Rovnomerne</option><option value="nights" ${x.split_method==='nights'?'selected':''}>Podľa nocí</option><option value="custom" ${x.split_method==='custom'?'selected':''}>Vlastné váhy</option></select></label>
    <div id="editExpCustom" class="custom-weights"></div>
    <div class="sheet-actions"><button class="primary" type="submit">${icon('save')}Uložiť zmeny</button><button class="danger" type="button" id="deleteExpense">${icon('trash')}</button></div>`;
  hydrateAvatars($('expenseEditForm')); renderCustomWeights('editExpCustom','editExpParticipants',weights);
  $('editExpSplit').onchange=()=>renderCustomWeights('editExpCustom','editExpParticipants',readWeightInputs('editExpCustom'));
  $('editExpParticipants').onchange=()=>renderCustomWeights('editExpCustom','editExpParticipants',readWeightInputs('editExpCustom'));
  $('expenseEditForm').onsubmit=saveExpenseEdit; $('deleteExpense').onclick=deleteExpense;
}
async function saveExpenseEdit(e){e.preventDefault();try{const ids=selectedIds('editExpParticipants');const amount=Number($('editExpAmount').value);if(!(amount>0)||!ids.length)throw new Error('Zadaj sumu a účastníkov.');const payload={expense_date:$('editExpDate').value,category_id:$('editExpCategory').value||null,description:$('editExpDescription').value.trim(),amount,currency_code:$('editExpCurrency').value,paid_by:$('editExpPaidBy').value,participant_ids:ids,split_method:$('editExpSplit').value,custom_weights:readWeightInputs('editExpCustom')};const {error}=await S.client.from('expenses').update(payload).eq('id',S.expenseEditId).eq('trip_id',S.tripId);if(error)throw error;closeSheets();await loadAllData();toast('Výdavok upravený.');}catch(err){toast(err.message,true);}}
async function deleteExpense(){if(!confirm('Zmazať tento výdavok?'))return;try{const{error}=await S.client.from('expenses').delete().eq('id',S.expenseEditId).eq('trip_id',S.tripId);if(error)throw error;closeSheets();await loadAllData();toast('Výdavok zmazaný.');}catch(err){toast(err.message,true);}}

/* ---------- Payments & settlement ---------- */
function renderPayeeIbanHint(){
  const el=$('payeeIbanHint'); if(!el)return; const p=participant($('payTo')?.value); const iban=normalizeIBAN(p?.iban);
  if(!iban){el.hidden=true;el.innerHTML='';return;}
  el.hidden=false; el.innerHTML=`<div class="copy"><b>IBAN príjemcu</b><code>${esc(formatIBAN(iban))}</code></div><button class="iban-copy" type="button" title="Kopírovať IBAN">${icon('copy')}</button>`;
  el.querySelector('button').onclick=()=>copyText(iban,'IBAN skopírovaný');
}
async function savePayment(e){e.preventDefault();try{const amount=Number($('payAmount').value),from=$('payFrom').value,to=$('payTo').value;if(!(amount>0)||from===to)throw new Error('Skontroluj sumu, platiteľa a príjemcu.');const{error}=await S.client.from('payments').insert({trip_id:S.tripId,payment_date:$('payDate').value,from_participant:from,to_participant:to,amount,currency_code:$('payCurrency').value,note:$('payNote').value.trim()});if(error)throw error;$('payAmount').value='';$('payNote').value='';await loadAllData();toast('Platba uložená.');}catch(err){toast(err.message,true);}}
function renderPayments(){
  $('paymentFeed').innerHTML=S.payments.length?S.payments.map(x=>{const f=participant(x.from_participant),t=participant(x.to_participant);return `<div class="feed-row"><span class="feed-icon">${icon('euro')}</span><span class="feed-copy"><b>${esc(f?.name||'?')} → ${esc(t?.name||'?')}</b><small>${dateLabel(x.payment_date)}${x.note?' · '+esc(x.note):''}</small></span><span class="feed-value">${round(x.amount,2)} ${esc(x.currency_code)}</span><button class="icon-button pay-delete" data-id="${x.id}">${icon('trash')}</button></div>`;}).join(''):`<div class="empty">Žiadne platby medzi účastníkmi.</div>`;
  $$('.pay-delete').forEach(b=>b.onclick=async()=>{if(!confirm('Zmazať platbu?'))return;const{error}=await S.client.from('payments').delete().eq('id',b.dataset.id);if(error)return toast(error.message,true);await loadAllData();});
}
function balances(){ const z={};S.participants.forEach(p=>z[p.id]={paid:0,share:0,sent:0,received:0,balance:0});S.expenses.forEach(x=>{if(z[x.paid_by])z[x.paid_by].paid+=centsEUR(x.amount,x.currency_code);const sh=expenseShares(x);Object.entries(sh).forEach(([id,c])=>{if(z[id])z[id].share+=c;});});S.payments.forEach(x=>{const c=centsEUR(x.amount,x.currency_code);if(z[x.from_participant])z[x.from_participant].sent+=c;if(z[x.to_participant])z[x.to_participant].received+=c;});Object.values(z).forEach(v=>v.balance=v.paid-v.share+v.sent-v.received);return z; }
function transfers(z){const d=Object.entries(z).filter(([,x])=>x.balance<0).map(([id,x])=>[id,-x.balance]).sort((a,b)=>b[1]-a[1]),c=Object.entries(z).filter(([,x])=>x.balance>0).map(([id,x])=>[id,x.balance]).sort((a,b)=>b[1]-a[1]),out=[];let i=0,j=0;while(i<d.length&&j<c.length){const v=Math.min(d[i][1],c[j][1]);if(v>0)out.push({from:d[i][0],to:c[j][0],amount:v});d[i][1]-=v;c[j][1]-=v;if(!d[i][1])i++;if(!c[j][1])j++;}return out;}
function renderSettlement(){const z=balances(),tr=transfers(z);$('settlementTransfers').innerHTML=tr.length?tr.map(x=>{const to=participant(x.to),iban=normalizeIBAN(to?.iban);return `<div class="transfer">${avatarHTML(participant(x.from),'s')}<b>${esc(participant(x.from)?.name)}</b><span class="arrow">→</span>${avatarHTML(to,'s')}<b>${esc(to?.name)}</b><span class="amount">${eur(x.amount)}</span>${iban?`<span class="iban-transfer"><code>${esc(formatIBAN(iban))}</code><button type="button" data-copy-iban="${esc(iban)}">${icon('copy')} Kopírovať</button></span>`:''}</div>`;}).join(''):`<div class="empty">Všetko je vyrovnané.</div>`;$('balanceList').innerHTML=S.participants.map(p=>{const x=z[p.id];return `<div class="balance-row"><span>${avatarHTML(p,'s')} <b>${esc(p.name)}</b></span><strong class="${x.balance>0?'plus':x.balance<0?'minus':''}">${eur(x.balance)}</strong></div>`;}).join('');const cats={};S.expenses.forEach(x=>{const n=category(x.category_id)?.name||'Iné';cats[n]=(cats[n]||0)+centsEUR(x.amount,x.currency_code);});const max=Math.max(1,...Object.values(cats));$('categoryCosts').innerHTML=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([n,v])=>`<div class="metric-row"><span>${esc(n)}</span><b>${eur(v)}</b><div class="metric-bar"><span style="width:${100*v/max}%"></span></div></div>`).join('')||`<div class="empty">Žiadne náklady.</div>`;$$('[data-copy-iban]',$('tab-settlement')).forEach(b=>b.onclick=()=>copyText(b.dataset.copyIban,'IBAN skopírovaný'));hydrateAvatars($('tab-settlement'));}

/* ---------- Bathroom ---------- */
const BATH_SLOTS=['08:00','08:15','08:30','08:45','09:00'];
function morningPresent(p,date){return !!(p?.arrival_date&&p?.departure_date&&p.arrival_date<date&&date<=p.departure_date);}
function morningDays(){const starts=S.participants.map(p=>p.arrival_date).filter(Boolean).sort(),ends=S.participants.map(p=>p.departure_date).filter(Boolean).sort();if(!starts.length||!ends.length)return[];const out=[];for(let d=addDays(starts[0],1);d<=ends.at(-1);d=addDays(d,1))out.push(d);return out;}
function booking(date,slot,bath){return S.bathroom.find(x=>x.booking_date===date&&String(x.slot).slice(0,5)===slot&&Number(x.bathroom_no)===bath);}
function renderBathroom(){
  const days=morningDays(),today=todayISO();let openDay=days.find(d=>d>=today)||days.at(-1);
  $('bathroomDays').innerHTML=days.length?days.map(date=>{const present=S.participants.filter(p=>morningPresent(p,date)),books=S.bathroom.filter(x=>x.booking_date===date),unique=[...new Set(books.map(x=>x.participant_id))];const rows=BATH_SLOTS.map(slot=>`<div class="bath-cell time">${slot}</div>${[1,2].map(no=>{const b=booking(date,slot,no);return `<div class="bath-cell"><select class="bath-select" data-date="${date}" data-slot="${slot}" data-bath="${no}">${selectOptions(present,b?.participant_id||'',true)}</select></div>`;}).join('')}`).join('');return `<details class="day-card" ${date===openDay?'open':''}><summary><div class="day-summary-copy"><b>${dateLong(date)}</b><small>${books.length}/10 slotov rezervovaných</small></div>${avatarStack(unique,4)}${icon('down','chev')}</summary><div class="day-body"><div class="bath-grid"><div></div><div class="bath-head">Kúpeľňa 1</div><div class="bath-head">Kúpeľňa 2</div>${rows}</div></div></details>`;}).join(''):`<div class="empty">Najprv nastav príchod a odchod účastníkov.</div>`;
  $$('.bath-select').forEach(s=>s.onchange=()=>saveBathroom(s));
  $('bathroomMatrix').innerHTML=days.map(date=>`<div class="matrix-day"><b>${dateLabel(date)}</b><div class="matrix-chips">${S.participants.filter(p=>morningPresent(p,date)).map(p=>{const mine=S.bathroom.filter(x=>x.booking_date===date&&x.participant_id===p.id).sort((a,b)=>String(a.slot).localeCompare(String(b.slot)));return mine.length?`<span class="matrix-chip">${esc(p.name)} · K${mine[0].bathroom_no} ${String(mine[0].slot).slice(0,5)}${mine.length>1?' +'+(mine.length-1):''}</span>`:`<span class="matrix-chip missing">${esc(p.name)} · nemá</span>`;}).join('')}</div></div>`).join('');hydrateAvatars($('view-bathroom'));
}
async function saveBathroom(sel){try{const{error}=await S.client.rpc('save_bathroom_booking',{p_trip_id:S.tripId,p_booking_date:sel.dataset.date,p_slot:sel.dataset.slot,p_bathroom_no:Number(sel.dataset.bath),p_participant_id:sel.value||null});if(error)throw error;await loadAllData();toast('Rezervácia uložená.');}catch(err){toast(err.message,true);await loadAllData();}}

/* ---------- Statistics ---------- */
function tripDateFromISO(iso){try{return new Intl.DateTimeFormat('en-CA',{timeZone:S.trip?.timezone||'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));}catch{return String(iso).slice(0,10);}}
function tripTimeMinutes(iso){try{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:S.trip?.timezone||'Europe/Madrid',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));const h=Number(parts.find(x=>x.type==='hour')?.value||0),m=Number(parts.find(x=>x.type==='minute')?.value||0);return h*60+m;}catch{return 0;}}
function presentDays(p,completedOnly=false){const a=p.arrival_date||S.trip.start_date,b=p.departure_date||S.trip.end_date;if(!a||!b)return[];const today=todayISO(),out=[];for(let d=a;d<=b;d=addDays(d,1)){if(d<S.trip.start_date||d>S.trip.end_date)continue;if(completedOnly&&d>=today)continue;out.push(d);}return out;}
function computeStats(){
  const st={};S.participants.forEach(p=>st[p.id]={id:p.id,km:0,elev:0,min:0,rides:0,cleanRides:0,beer:0,wine:0,spirits:0,drinks:0,crash:0,puncture:0,mechanical:0,sprintWins:0,hillWins:0,podiums:0,competitionPts:0,records:0,paid:0,share:0,drinkPts:0,soberDays:0,soberDates:[],recoveryDays:0,socialDays:0,varietyDays:0,drinkDays:0,types:new Set(),latestDrinkMinute:-1});
  const rideMishaps={};S.rides.forEach(r=>{rideMishaps[r.id]={};(r.participant_ids||[]).forEach(id=>rideMishaps[r.id][id]=0);(r.participant_ids||[]).forEach(id=>{if(st[id]){st[id].km+=Number(r.distance_km)||0;st[id].elev+=Number(r.elevation_m)||0;st[id].min+=Number(r.duration_minutes)||0;st[id].rides++;}});});
  const cfg=scoreSettings(); const placementPts={sprint:[cfg.sprint_first,cfg.sprint_second,cfg.sprint_third],hill:[cfg.hill_first,cfg.hill_second,cfg.hill_third]};S.rideEvents.forEach(ev=>{if(['crash','puncture','mechanical'].includes(ev.event_type)){const id=ev.participant_id;if(st[id])st[id][ev.event_type]++;if(rideMishaps[ev.ride_id]&&id)rideMishaps[ev.ride_id][id]=(rideMishaps[ev.ride_id][id]||0)+1;}else if(['sprint','hill'].includes(ev.event_type)){[ev.first_place,ev.second_place,ev.third_place].forEach((id,i)=>{if(id&&st[id]){st[id].competitionPts+=placementPts[ev.event_type][i];st[id].podiums++;if(i===0)st[id][ev.event_type==='sprint'?'sprintWins':'hillWins']++;}});}});
  S.rides.forEach(r=>(r.participant_ids||[]).forEach(id=>{if(st[id]&&!(rideMishaps[r.id]?.[id]>0))st[id].cleanRides++;}));
    const dayAgg={};S.drinks.forEach(d=>{const id=d.participant_id;if(!st[id])return;const date=tripDateFromISO(d.consumed_at),k=id+'|'+date;dayAgg[k]??={beer:0,wine:0,spirits:0,occasions:new Set()};dayAgg[k].beer+=Number(d.beer)||0;dayAgg[k].wine+=Number(d.wine)||0;dayAgg[k].spirits+=Number(d.spirits)||0;dayAgg[k].occasions.add(d.occasion);st[id].beer+=Number(d.beer)||0;st[id].wine+=Number(d.wine)||0;st[id].spirits+=Number(d.spirits)||0;const tm=tripTimeMinutes(d.consumed_at);st[id].latestDrinkMinute=Math.max(st[id].latestDrinkMinute,tm);});
  S.participants.forEach(p=>{const x=st[p.id];x.drinks=x.beer+x.wine+x.spirits;if(x.beer)x.types.add('beer');if(x.wine)x.types.add('wine');if(x.spirits)x.types.add('spirits');x.drinkDays=Object.keys(dayAgg).filter(k=>k.startsWith(p.id+'|')).length;presentDays(p,true).forEach(date=>{const a=dayAgg[p.id+'|'+date];if(!a){x.soberDays++;x.soberDates.push(date);}else{const types=[a.beer,a.wine,a.spirits].filter(v=>v>0).length;if(types>=2)x.varietyDays++;if(a.occasions.size>=2)x.socialDays++;}});x.drinkPts=x.drinks*cfg.drink_points+x.soberDays*cfg.sober_day_points;});
  const tripEnded=todayISO()>S.trip.end_date;S.participants.forEach(p=>{if(tripEnded&&st[p.id].drinks===0)st[p.id].drinkPts+=cfg.sober_trip_points;});
  // recovery day = sober calendar day immediately after a ride day for that rider
  S.participants.forEach(p=>{const rideDates=new Set(S.rides.filter(r=>(r.participant_ids||[]).includes(p.id)).map(r=>r.ride_date));st[p.id].recoveryDays=st[p.id].soberDates.filter(d=>rideDates.has(addDays(d,-1))).length;});
  // accountant records
  const byUser={};S.participants.forEach(p=>{if(p.user_id)byUser[p.user_id]=p.id;});['expenses','payments','bathroom','rides','drinks'].forEach(k=>S[k].forEach(r=>{const id=byUser[r.created_by];if(id&&st[id])st[id].records++;}));
  const bal=balances();S.participants.forEach(p=>{const id=p.id;st[id].paid=bal[id]?.paid||0;st[id].share=bal[id]?.share||0;});
  Object.values(st).forEach(x=>{const kmPts=Math.floor(x.km/Math.max(.01,Number(cfg.distance_km_per_point)||10)),elevPts=Math.floor(x.elev/Math.max(1,Number(cfg.elevation_m_per_point)||100)),mishap=x.crash*cfg.crash_points+x.puncture*cfg.puncture_points+x.mechanical*cfg.mechanical_points,soberPts=x.soberDays*cfg.sober_day_points+((tripEnded&&x.drinks===0)?cfg.sober_trip_points:0),drinkPts=x.drinks*cfg.drink_points;x.points={km:kmPts,elev:elevPts,sprintHill:x.competitionPts,crash:x.crash*cfg.crash_points,puncture:x.puncture*cfg.puncture_points,mechanical:x.mechanical*cfg.mechanical_points,drinks:drinkPts,sober:soberPts};x.groups={ride:kmPts+elevPts,competition:x.competitionPts,mishap,social:drinkPts+soberPts};x.score=sum(Object.values(x.groups));x.burned=Math.round(x.km*30+x.elev);x.drank=x.beer*210+x.wine*120+x.spirits*100;});
  return st;
}

/* ---------- Badges ---------- */
function computeBadges(st){
  if(S.badgeCache)return S.badgeCache; const defs=[]; const add=(id,family,title,description,iconName,tier='gold',earners=[],progression=null)=>defs.push({id,family,title,description,icon:iconName,tier,earners,progression});
  const earn=(id,date=null,count=null)=>({participantId:id,date,count});
  const rideById=Object.fromEntries(S.rides.map(r=>[r.id,r]));
  const maxRideKm=Math.max(0,...S.rides.map(r=>Number(r.distance_km)||0)); const maxRideElev=Math.max(0,...S.rides.map(r=>Number(r.elevation_m)||0));
  add('long-haul','Riding','Long Haul','Účastník najdlhšej jazdy.','route','blue',S.rides.filter(r=>Number(r.distance_km)===maxRideKm&&maxRideKm>0).flatMap(r=>(r.participant_ids||[]).map(id=>earn(id,r.ride_date))));
  add('mountain-goat','Riding','Mountain Goat','Účastník najkopcovitejšej jazdy.','mountain','blue',S.rides.filter(r=>Number(r.elevation_m)===maxRideElev&&maxRideElev>0).flatMap(r=>(r.participant_ids||[]).map(id=>earn(id,r.ride_date))));
  add('everest','Riding','Everest Club','Individuálne nastúpaných 8 849 m.','mountain','platinum',Object.values(st).filter(x=>x.elev>=8849).map(x=>earn(x.id,S.rides[0]?.ride_date)));
  add('podium-hunter','Riding','Podium Hunter','Aspoň tri umiestnenia na šprinte alebo kopci.','medal','gold',Object.values(st).filter(x=>x.podiums>=3).map(x=>earn(x.id,null,x.podiums)));
  const maxSprint=Math.max(0,...Object.values(st).map(x=>x.sprintWins)); add('sprint-king','Riding','Sprint King','Najviac víťazstiev v šprintoch.','sprint','gold',Object.values(st).filter(x=>x.sprintWins===maxSprint&&maxSprint>0).map(x=>earn(x.id,null,x.sprintWins)));
  const maxHill=Math.max(0,...Object.values(st).map(x=>x.hillWins)); add('hill-king','Riding','King of the Hills','Najviac víťazstiev na horských prémiách.','crown','gold',Object.values(st).filter(x=>x.hillWins===maxHill&&maxHill>0).map(x=>earn(x.id,null,x.hillWins)));
  const maxClean=Math.max(0,...Object.values(st).map(x=>x.cleanRides)); add('unbreakable','Riding','Unbreakable','Najviac jázd bez vlastného mishapu.','check','green',Object.values(st).filter(x=>x.cleanRides===maxClean&&maxClean>0).map(x=>earn(x.id,null,x.cleanRides)));

  const mishapTypes=[['crash','First Blood','Crash Club','crash'],['puncture','First Flat','Flat Club','flat'],['mechanical','Workshop Open','Roadside Mechanic','wrench']];
  mishapTypes.forEach(([type,firstTitle,goldTitle,ic])=>{const evs=S.rideEvents.filter(e=>e.event_type===type&&e.participant_id).sort((a,b)=>{const da=rideById[a.ride_id]?.ride_date||'',db=rideById[b.ride_id]?.ride_date||'';return da.localeCompare(db)||String(a.created_at).localeCompare(String(b.created_at));});add('first-'+type,'Mishaps',firstTitle,`Prvý ${type==='crash'?'pád':type==='puncture'?'defekt':'mechanický problém'} výpravy.` ,ic,'platinum',evs[0]?[earn(evs[0].participant_id,rideById[evs[0].ride_id]?.ride_date)]:[]);add(type+'-club','Mishaps',goldTitle,`Gold I = 1 · Gold II = 2 · Gold III = 3+ zaznamenané ${type==='crash'?'pády':type==='puncture'?'defekty':'mechanické problémy'}.`,ic,'gold',Object.values(st).filter(x=>x[type]>0).map(x=>earn(x.id,null,x[type])),'mishap');});
  add('triple-trouble','Mishaps','Triple Trouble','Pád, defekt aj mechanický problém počas jednej výpravy.','alert','red',Object.values(st).filter(x=>x.crash&&x.puncture&&x.mechanical).map(x=>earn(x.id)));
  const maxM=Math.max(0,...Object.values(st).map(x=>x.crash+x.puncture+x.mechanical));add('bad-luck','Mishaps','Bad Luck Brian','Najviac mishapov dokopy.','alert','red',Object.values(st).filter(x=>x.crash+x.puncture+x.mechanical===maxM&&maxM>0).map(x=>earn(x.id,null,maxM)));
  add('roadside-regular','Mishaps','Roadside Regular','Tri a viac defektov alebo mechanických problémov.','wrench','gold',Object.values(st).filter(x=>x.puncture+x.mechanical>=3).map(x=>earn(x.id,null,x.puncture+x.mechanical)));
  const crashDates={};S.rideEvents.filter(e=>e.event_type==='crash'&&e.participant_id).forEach(e=>{const d=rideById[e.ride_id]?.ride_date;if(d&&(!crashDates[e.participant_id]||d<crashDates[e.participant_id]))crashDates[e.participant_id]=d;});add('phoenix','Mishaps','Phoenix','Po páde sa vrátil na ďalšiu jazdu.','bike','red',Object.entries(crashDates).filter(([id,d])=>S.rides.some(r=>r.ride_date>d&&(r.participant_ids||[]).includes(id))).map(([id,d])=>earn(id,d)));

  add('sober-day','Recovery & drinks','Sober Day','Aspoň jeden ukončený deň bez alkoholu.','check','green',Object.values(st).filter(x=>x.soberDays>0).map(x=>earn(x.id,x.soberDates.at(-1),x.soberDays)));
  const ended=todayISO()>S.trip.end_date;add('sober-king','Recovery & drinks','Sober King','Celá výprava bez alkoholu.','crown','platinum',ended?Object.values(st).filter(x=>x.drinks===0).map(x=>earn(x.id,S.trip.end_date)):[]);
  add('variety-pack','Recovery & drinks','Variety Pack','Pivo, víno aj panák naprieč celou výpravou.','drink','purple',Object.values(st).filter(x=>x.types.size===3).map(x=>earn(x.id)));
  const maxTypes=Math.max(0,...Object.values(st).map(x=>x.types.size));add('palate','Recovery & drinks','Most Varied Palate','Najširšia paleta typov drinkov.','drink','purple',Object.values(st).filter(x=>x.types.size===maxTypes&&maxTypes>0).map(x=>earn(x.id,null,maxTypes)));
  const maxLate=Math.max(-1,...Object.values(st).map(x=>x.latestDrinkMinute));add('night-owl','Recovery & drinks','Night Owl','Najneskorší zaznamenaný drink.','clock','purple',Object.values(st).filter(x=>x.latestDrinkMinute===maxLate&&maxLate>=0).map(x=>earn(x.id,null,maxLate)));
  const maxRec=Math.max(0,...Object.values(st).map(x=>x.recoveryDays));add('recovery','Recovery & drinks','Recovery Specialist','Najviac sober dní hneď po jazde.','check','green',Object.values(st).filter(x=>x.recoveryDays===maxRec&&maxRec>0).map(x=>earn(x.id,null,maxRec)));
  add('social-calendar','Recovery & drinks','Social Calendar','Drinky pri aspoň dvoch príležitostiach v jeden deň.','calendar','purple',Object.values(st).filter(x=>x.socialDays>0).map(x=>earn(x.id,null,x.socialDays)));
  const maxSocialDays=Math.max(0,...Object.values(st).map(x=>x.drinkDays));add('social-days','Recovery & drinks','Most Social Days','Najviac dní s aspoň jedným zaznamenaným drinkom, nie najviac drinkov.','calendar','purple',Object.values(st).filter(x=>x.drinkDays===maxSocialDays&&maxSocialDays>0).map(x=>earn(x.id,null,x.drinkDays)));
  const ratios=Object.values(st).filter(x=>x.rides>0).map(x=>[x.id,x.soberDays/x.rides]);const maxRatio=Math.max(0,...ratios.map(x=>x[1]));add('balanced-rider','Recovery & drinks','Balanced Rider','Najvyšší pomer sober dní k odjazdeným jazdám.','bike','green',ratios.filter(x=>x[1]===maxRatio&&maxRatio>0).map(x=>earn(x[0],null,Math.round(x[1]*100))));

  const maxPaid=Math.max(0,...Object.values(st).map(x=>x.paid));add('financier','Trip & money','Chief Financier','Zaplatil najviac spoločných výdavkov.','wallet','gold',Object.values(st).filter(x=>x.paid===maxPaid&&maxPaid>0).map(x=>earn(x.id)));
  const maxShare=Math.max(0,...Object.values(st).map(x=>x.share));add('spender','Trip & money','Big Spender','Najvyšší osobný podiel na nákladoch.','euro','gold',Object.values(st).filter(x=>x.share===maxShare&&maxShare>0).map(x=>earn(x.id)));
  const maxRecN=Math.max(0,...Object.values(st).map(x=>x.records));add('accountant','Trip & money','Accountant','Najviac záznamov pridaných do appky.','receipt','blue',Object.values(st).filter(x=>x.records===maxRecN&&maxRecN>0).map(x=>earn(x.id,null,maxRecN)));
  const largest=S.expenses.slice().sort((a,b)=>centsEUR(b.amount,b.currency_code)-centsEUR(a.amount,a.currency_code))[0];add('treat','Trip & money','Treat Master','Zaplatil najväčší jednotlivý výdavok.','wallet','gold',largest?[earn(largest.paid_by,largest.expense_date)]:[]);
  S.badgeCache=defs;return defs;
}
function personBadges(id,st){return computeBadges(st).filter(b=>b.earners.some(e=>e.participantId===id));}

/* ---------- Cup render ---------- */
function renderCup(){const st=computeStats();renderCupSummary(st);renderRanking(st);renderEverest(st);renderQuadrant(st);renderCalories(st);renderRides();renderDrinks(st);renderBadges(st);}

function renderCupSummary(st){
  const arr=Object.values(st),totalRides=S.rides.length,totalKm=sum(arr.map(x=>x.km)),totalElev=sum(arr.map(x=>x.elev)),totalMin=sum(arr.map(x=>x.min)),totalMish=sum(arr.map(x=>x.crash+x.puncture+x.mechanical)),totalDrinks=sum(arr.map(x=>x.drinks));
  $('cupSummary').innerHTML=[[icon('bike'),'Jázd',totalRides],[icon('route'),'Km spolu',round(totalKm,1)],[icon('mountain'),'Prevýšenie',round(totalElev)+' m'],[icon('clock'),'V sedle',minutesToHM(totalMin)],[icon('drink'),'Drinkov',totalDrinks],[icon('alert'),'Mishapov',totalMish]].map(([ic,l,v])=>`<div class="summary-tile">${ic}<b>${v}</b><span>${l}</span></div>`).join('');
  const cfg=scoreSettings(); const rules=[['Jazda',`${cfg.distance_km_per_point} km = 1 b · ${cfg.elevation_m_per_point} m = 1 b`],['Šprint',`1./2./3. = ${cfg.sprint_first}/${cfg.sprint_second}/${cfg.sprint_third} b`],['Horská prémia',`1./2./3. = ${cfg.hill_first}/${cfg.hill_second}/${cfg.hill_third} b`],['Mishaps',`pád ${cfg.crash_points} · defekt ${cfg.puncture_points} · mechanika ${cfg.mechanical_points} b`],['Drinky',`1 drink = ${cfg.drink_points} b`],['Recovery',`sober day +${cfg.sober_day_points} · celý trip sober +${cfg.sober_trip_points}`]];
  $('scoreRules').innerHTML=rules.map(([a,b])=>`<div class="metric-row"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join('');
}

function renderRanking(st){
  $('scoreLegend').innerHTML=[['ride','Jazda'],['competition','Súťaže'],['mishap','Mishaps'],['social','Drinky / recovery']].map(([c,l])=>`<span class="legend-chip"><i class="legend-dot ${c}"></i>${l}</span>`).join('');
  const list=Object.values(st).sort((a,b)=>b.score-a.score); const max=Math.max(1,...list.map(x=>x.score));
  $('rankingList').innerHTML=list.map((x,i)=>{const p=participant(x.id),badges=personBadges(x.id,st).slice().sort((a,b)=>(a.tier==='platinum'?-1:1)-(b.tier==='platinum'?-1:1)).slice(0,3);const seg=(k)=>`<span class="${k}" style="width:${100*x.groups[k]/max}%"></span>`;return `<article class="rank-card"><button class="rank-main" data-rank="${x.id}"><span class="rank-pos">${i+1}</span>${avatarHTML(p,'m')}<span class="rank-name"><b>${esc(p?.name)}</b><small>${round(x.km,1)} km · ${round(x.elev)} m · ${x.podiums} pódií</small><span class="score-stack">${seg('ride')}${seg('competition')}${seg('mishap')}${seg('social')}</span></span><span class="rank-score">${x.score}<small> b</small></span>${icon('down','feed-chevron')}</button><div class="rank-details"><div class="rank-breakdown">${rankMetric('Kilometre',x.points.km,round(x.km,1)+' km')}${rankMetric('Prevýšenie',x.points.elev,round(x.elev)+' m')}${rankMetric('Šprinty + kopce',x.points.sprintHill,x.podiums+' pódií')}${rankMetric('Pády',x.points.crash,x.crash+'×')}${rankMetric('Defekty',x.points.puncture,x.puncture+'×')}${rankMetric('Mechanika',x.points.mechanical,x.mechanical+'×')}${rankMetric('Drinky',x.points.drinks,x.drinks+'×')}${rankMetric('Sober bonus',x.points.sober,x.soberDays+' sober dní')}</div><div class="rank-badges">${badges.map(b=>`<span class="tiny-badge">${icon(b.icon)}${esc(b.title)}${badgePersonSuffix(b,x.id)}</span>`).join('')}</div></div></article>`;}).join('');
  $$('[data-rank]').forEach(b=>b.onclick=()=>b.closest('.rank-card').classList.toggle('open'));hydrateAvatars($('rankingList'));
}
function rankMetric(l,v,s){return `<div class="rank-metric"><span>${esc(l)}</span><b>${v||0} b</b><small>${esc(s||'')}</small></div>`;}
function renderEverest(st){const EV=8849,group=sum(Object.values(st).map(x=>x.elev)),done=Math.floor(group/EV),rem=group%EV,pct=100*rem/EV; $('everestBig').textContent=`${done}×`;$('everestGroup').innerHTML=`<div class="everest-progress"><span style="width:${pct}%"></span></div><div class="everest-copy"><span>${round(group)} m spolu</span><span>${done?round(rem)+' m do Everest #'+(done+1):round(group)+' / 8 849 m'}</span></div>`;const people=Object.values(st).sort((a,b)=>b.elev-a.elev);$('everestPeople').innerHTML=people.map(x=>{const p=participant(x.id),times=x.elev/EV,pp=100*(x.elev%EV)/EV;return `<div class="everest-person">${avatarHTML(p,'m')}<span class="name"><b>${esc(p?.name)}</b><small>${round(x.elev)} m · ${round(times,2)}× Everest</small></span><strong>${group?round(100*x.elev/group)+'%':'0%'}</strong><div class="everest-mini"><span style="width:${clamp(pp,0,100)}%"></span></div></div>`;}).join('');hydrateAvatars($('everestPeople'));}
function renderQuadrant(st){const arr=Object.values(st),maxKm=Math.max(1,...arr.map(x=>x.km)),maxD=Math.max(1,...arr.map(x=>x.drinks));$('quadrant').innerHTML=`<span class="quad-label tl">social</span><span class="quad-label tr">legenda</span><span class="quad-label bl">recovery</span><span class="quad-label br">kilometre</span>`+arr.map(x=>{const p=participant(x.id),left=12+76*x.km/maxKm,bottom=12+70*x.drinks/maxD;return `<div class="quad-point" style="left:${left}%;bottom:${bottom}%">${avatarHTML(p,'s')}<small>${esc(p?.name)}</small></div>`;}).join('');hydrateAvatars($('quadrant'));}
function renderCalories(st){const arr=Object.values(st),max=Math.max(1,...arr.map(x=>Math.max(x.burned,x.drank)));$('calories').innerHTML=arr.map(x=>{const p=participant(x.id),bal=x.burned-x.drank;return `<div class="cal-row"><b>${esc(p?.name)}</b><div class="cal-axis"><div class="cal-left"><span style="width:${50*x.burned/max}%"></span></div><div class="cal-right"><span style="width:${50*x.drank/max}%"></span></div></div><small>${bal>=0?'−':'+'}${round(Math.abs(bal))} kcal</small></div>`;}).join('');}

/* ---------- Ride builder / details ---------- */
function eventIcon(type){return {sprint:'sprint',hill:'mountain',crash:'crash',puncture:'flat',mechanical:'wrench'}[type]||'other';}
function addRideEvent(kind,mode){const arr=mode==='new'?S.newRideEvents:S.editRideEvents;const ids=mode==='new'?selectedIds('rideParticipants'):selectedIds('rideSheetParticipants');if(kind==='sprint'||kind==='hill'){const n=arr.filter(x=>x.event_type===kind).length+1;arr.push({event_type:kind,title:kind==='sprint'?`Šprint ${n}`:`Horská prémia ${n}`,first_place:ids[0]||'',second_place:ids[1]||'',third_place:ids[2]||'',note:''});}else arr.push({event_type:'crash',title:'',participant_id:ids[0]||S.me?.id||'',note:''});renderEventEditor(mode==='new'?'newRideEvents':'rideSheetEvents',arr,ids,mode);}
function renderEventEditor(containerId,arr,riderIds,mode){const el=$(containerId);if(!el)return;const riders=riderIds.map(participant).filter(Boolean);el.innerHTML=arr.length?arr.map((ev,i)=>{if(ev.event_type==='sprint'||ev.event_type==='hill')return `<div class="event-card"><div class="event-card-head">${icon(eventIcon(ev.event_type))}<b>${ev.event_type==='sprint'?'Šprint':'Horská prémia'}</b><button type="button" data-event-remove="${i}" data-mode="${mode}">${icon('trash')}</button></div><label>Názov<input data-event-index="${i}" data-event-field="title" data-mode="${mode}" value="${esc(ev.title||'')}"></label><div class="form-grid three"><label>1. miesto<select data-event-index="${i}" data-event-field="first_place" data-mode="${mode}">${selectOptions(riders,ev.first_place,true)}</select></label><label>2. miesto<select data-event-index="${i}" data-event-field="second_place" data-mode="${mode}">${selectOptions(riders,ev.second_place,true)}</select></label><label>3. miesto<select data-event-index="${i}" data-event-field="third_place" data-mode="${mode}">${selectOptions(riders,ev.third_place,true)}</select></label></div></div>`;return `<div class="event-card"><div class="event-card-head">${icon(eventIcon(ev.event_type))}<b>Mishap</b><button type="button" data-event-remove="${i}" data-mode="${mode}">${icon('trash')}</button></div><div class="form-grid two"><label>Typ<select data-event-index="${i}" data-event-field="event_type" data-mode="${mode}"><option value="crash" ${ev.event_type==='crash'?'selected':''}>Pád</option><option value="puncture" ${ev.event_type==='puncture'?'selected':''}>Defekt</option><option value="mechanical" ${ev.event_type==='mechanical'?'selected':''}>Mechanika</option></select></label><label>Kto<select data-event-index="${i}" data-event-field="participant_id" data-mode="${mode}">${selectOptions(riders,ev.participant_id,true)}</select></label></div><label>Poznámka<input data-event-index="${i}" data-event-field="note" data-mode="${mode}" value="${esc(ev.note||'')}" placeholder="napr. reťaz, plášť, ego"></label></div>`;}).join(''):`<div class="empty">Bez udalostí. To je tiež dobrý výsledok.</div>`;
  $$('[data-event-index]',el).forEach(inp=>inp.onchange=()=>{const a=inp.dataset.mode==='new'?S.newRideEvents:S.editRideEvents;a[Number(inp.dataset.eventIndex)][inp.dataset.eventField]=inp.value;if(inp.dataset.eventField==='event_type')renderEventEditor(containerId,a,riderIds,mode);});
  $$('[data-event-remove]',el).forEach(b=>b.onclick=()=>{const a=b.dataset.mode==='new'?S.newRideEvents:S.editRideEvents;a.splice(Number(b.dataset.eventRemove),1);renderEventEditor(containerId,a,riderIds,mode);});
}
function validateEvents(events,riderIds){const set=new Set(riderIds);for(const e of events){if(e.event_type==='sprint'||e.event_type==='hill'){const ids=[e.first_place,e.second_place,e.third_place].filter(Boolean);if(new Set(ids).size!==ids.length)throw new Error('Na pódiu nemôže byť ten istý jazdec dvakrát.');if(ids.some(id=>!set.has(id)))throw new Error('Pódium môže obsahovať iba účastníkov jazdy.');}else if(!e.participant_id||!set.has(e.participant_id))throw new Error('Pri mishape vyber jazdca z jazdy.');}}
async function saveNewRide(e){e.preventDefault();try{const ids=selectedIds('rideParticipants'),km=Number($('rideKm').value),mins=hmToMinutes($('rideDuration').value);if(!$('rideRoute').value.trim()||!(km>0)||!ids.length)throw new Error('Vyplň trasu, kilometre a jazdcov.');if($('rideDuration').value&&!/^(\d{1,2}):(\d{2})$/.test($('rideDuration').value))throw new Error('Čas zadaj ako hh:mm.');validateEvents(S.newRideEvents,ids);const{error}=await S.client.rpc('save_ride_with_events',{p_ride_id:null,p_trip_id:S.tripId,p_ride_date:$('rideDate').value,p_route:$('rideRoute').value.trim(),p_distance_km:km,p_elevation_m:Number($('rideElevation').value)||0,p_duration_minutes:mins,p_participant_ids:ids,p_notes:$('rideNotes').value.trim(),p_events:S.newRideEvents.map((x,i)=>({...x,sort_order:i}))});if(error)throw error;$('rideRoute').value=$('rideKm').value=$('rideElevation').value=$('rideDuration').value=$('rideNotes').value='';S.newRideEvents=[];$('newRideAccordion').open=false;await loadAllData();toast('Jazda uložená.');}catch(err){toast(err.message,true);}}
function rideEvents(id){return S.rideEvents.filter(e=>e.ride_id===id);}
function renderRides(){ $('rideCount').textContent=`${S.rides.length} jázd`;$('rideFeed').innerHTML=S.rides.length?S.rides.map(r=>{const ev=rideEvents(r.id),comp=ev.filter(e=>['sprint','hill'].includes(e.event_type)).length,mish=ev.filter(e=>['crash','puncture','mechanical'].includes(e.event_type)).length;return `<button class="feed-row ride-open" data-id="${r.id}"><span class="feed-icon bike">${icon('bike')}</span><span class="feed-copy"><b>${esc(r.route)}${r.is_test?' <span class="test-pill">TEST</span>':''}</b><small>${dateLabel(r.ride_date)} · ${avatarStack(r.participant_ids,3)} · ${comp} prémií · ${mish} mishapov</small></span><span class="feed-value">${round(r.distance_km,1)} km<small>${round(r.elevation_m)} m</small></span>${icon('chevron','feed-chevron')}</button>`;}).join(''):`<div class="empty">Prvá jazda ešte čaká.</div>`;$$('.ride-open').forEach(b=>b.onclick=()=>openRideSheet(b.dataset.id));hydrateAvatars($('rideFeed'));}
function openRideSheet(id){S.editRideId=id;S.rideEditing=false;const r=S.rides.find(x=>x.id===id);if(!r)return;$('rideSheetTitle').textContent=r.route;renderRideSheet();openSheet('rideSheet');}
function renderRideSheet(){const r=S.rides.find(x=>x.id===S.editRideId);if(!r)return;if(S.rideEditing){renderRideEdit(r);return;}const ev=rideEvents(r.id);$('rideSheetContent').innerHTML=`<div class="ride-detail-hero"><div><h3>${esc(r.route)}${r.is_test?' <span class="test-pill">TEST</span>':''}</h3><p>${dateLong(r.ride_date)}</p><div class="ride-kpis"><div class="ride-kpi"><b>${round(r.distance_km,1)}</b><span>km</span></div><div class="ride-kpi"><b>${round(r.elevation_m)}</b><span>m hore</span></div><div class="ride-kpi"><b>${minutesToHM(r.duration_minutes)}</b><span>čas</span></div></div></div>${avatarStack(r.participant_ids,4)}</div><div class="ride-events-view">${ev.length?ev.map(renderRideEventView).join(''):`<div class="empty">Bez prémií a mishapov.</div>`}</div>${r.notes?`<div class="info-strip">${esc(r.notes)}</div>`:''}<div class="sheet-mode-actions"><button class="secondary" id="rideEditBtn">${icon('edit')} Upraviť</button><button class="danger" id="rideDeleteBtn">${icon('trash')} Zmazať</button></div>`;$('rideEditBtn').onclick=()=>{S.rideEditing=true;S.editRideEvents=ev.map(x=>({...x}));renderRideSheet();};$('rideDeleteBtn').onclick=deleteRide;hydrateAvatars($('rideSheetContent'));}
function renderRideEventView(ev){if(ev.event_type==='sprint'||ev.event_type==='hill'){const places=[ev.first_place,ev.second_place,ev.third_place].map(participant);return `<div class="ride-event-view"><b>${icon(eventIcon(ev.event_type))} ${esc(ev.title|| (ev.event_type==='sprint'?'Šprint':'Horská prémia'))}</b><div class="podium">${places.map((p,i)=>p?`<span>${i+1}. ${avatarHTML(p,'s')} ${esc(p.name)}</span>`:'').join('')}</div>${ev.note?`<p>${esc(ev.note)}</p>`:''}</div>`;}const p=participant(ev.participant_id);return `<div class="ride-event-view"><b>${icon(eventIcon(ev.event_type))} ${ev.event_type==='crash'?'Pád':ev.event_type==='puncture'?'Defekt':'Mechanika'} · ${esc(p?.name||'')}</b>${ev.note?`<p>${esc(ev.note)}</p>`:''}</div>`;}
function renderRideEdit(r){S.editRideEvents=S.editRideEvents.length||!rideEvents(r.id).length?S.editRideEvents:rideEvents(r.id).map(x=>({...x}));$('rideSheetContent').innerHTML=`<form id="rideEditForm"><div class="form-grid two"><label>Dátum<input id="rsDate" type="date" value="${esc(r.ride_date)}"></label><label>Trasa<input id="rsRoute" value="${esc(r.route)}"></label></div><div class="form-grid three"><label>Km<input id="rsKm" type="number" step="0.1" value="${esc(r.distance_km)}"></label><label>Prevýšenie<input id="rsElevation" type="number" value="${esc(r.elevation_m)}"></label><label>Čas<input id="rsDuration" value="${minutesToHM(r.duration_minutes)}"></label></div><label>Kto išiel</label><div id="rideSheetParticipants" class="choice-grid">${choiceChips(r.participant_ids,'rsP')}</div><label>Poznámka<textarea id="rsNotes" rows="2">${esc(r.notes)}</textarea></label><div class="event-add-row"><button type="button" class="soft-button" data-rs-add="sprint">${icon('sprint')}Šprint</button><button type="button" class="soft-button" data-rs-add="hill">${icon('mountain')}Kopec</button><button type="button" class="soft-button" data-rs-add="mishap">${icon('wrench')}Mishap</button></div><div id="rideSheetEvents" class="event-editor"></div><div class="sheet-actions"><button class="primary" type="submit">${icon('save')}Uložiť zmeny</button><button type="button" class="secondary" id="rideEditCancel">Zrušiť</button></div></form>`;hydrateAvatars($('rideSheetContent'));renderEventEditor('rideSheetEvents',S.editRideEvents,selectedIds('rideSheetParticipants'),'edit');$('rideSheetParticipants').onchange=()=>renderEventEditor('rideSheetEvents',S.editRideEvents,selectedIds('rideSheetParticipants'),'edit');$$('[data-rs-add]').forEach(b=>b.onclick=()=>addRideEvent(b.dataset.rsAdd,'edit'));$('rideEditCancel').onclick=()=>{S.rideEditing=false;renderRideSheet();};$('rideEditForm').onsubmit=saveRideEdit;}
async function saveRideEdit(e){e.preventDefault();try{const ids=selectedIds('rideSheetParticipants'),km=Number($('rsKm').value);if(!$('rsRoute').value.trim()||!(km>0)||!ids.length)throw new Error('Vyplň trasu, kilometre a jazdcov.');validateEvents(S.editRideEvents,ids);const{error}=await S.client.rpc('save_ride_with_events',{p_ride_id:S.editRideId,p_trip_id:S.tripId,p_ride_date:$('rsDate').value,p_route:$('rsRoute').value.trim(),p_distance_km:km,p_elevation_m:Number($('rsElevation').value)||0,p_duration_minutes:hmToMinutes($('rsDuration').value),p_participant_ids:ids,p_notes:$('rsNotes').value.trim(),p_events:S.editRideEvents.map((x,i)=>({...x,sort_order:i}))});if(error)throw error;await loadAllData();S.rideEditing=false;renderRideSheet();toast('Jazda upravená.');}catch(err){toast(err.message,true);}}
async function deleteRide(){if(!confirm('Zmazať túto jazdu aj všetky jej udalosti?'))return;try{const{error}=await S.client.from('rides').delete().eq('id',S.editRideId).eq('trip_id',S.tripId);if(error)throw error;closeSheets();await loadAllData();toast('Jazda zmazaná.');}catch(err){toast(err.message,true);}}

/* ---------- Drinks ---------- */
const occasionLabel=o=>({lunch:'Obed',dinner:'Večera',evening:'Večer',other:'Iné'}[o]||o);
async function saveDrink(e){e.preventDefault();try{const beer=Number($('drinkBeer').value)||0,wine=Number($('drinkWine').value)||0,spirits=Number($('drinkSpirits').value)||0;if(beer+wine+spirits<=0)throw new Error('Zadaj aspoň jeden drink.');const local=`${$('drinkDate').value}T${$('drinkTime').value}:00`;const iso=new Date(local).toISOString();const{error}=await S.client.from('drinks').insert({trip_id:S.tripId,participant_id:$('drinkPerson').value,consumed_at:iso,occasion:$('drinkOccasion').value,beer,wine,spirits,note:$('drinkNote').value.trim()});if(error)throw error;$('drinkBeer').value=$('drinkWine').value=$('drinkSpirits').value=0;$('drinkNote').value='';$('drinkTime').value=nowHHMM();await loadAllData();toast('Drink zapísaný.');}catch(err){toast(err.message,true);}}
function renderDrinks(st){const total=sum(Object.values(st).map(x=>x.drinks)),sober=sum(Object.values(st).map(x=>x.soberDays)),variety=sum(Object.values(st).map(x=>x.varietyDays)),social=sum(Object.values(st).map(x=>x.socialDays));$('drinkStats').innerHTML=[[icon('drink'),'Drinkov',total],[icon('check'),'Sober dní',sober],[icon('drink'),'Variety dní',variety],[icon('calendar'),'Social dní',social]].map(([ic,l,v])=>`<div class="summary-tile">${ic}<b>${v}</b><span>${l}</span></div>`).join('');$('drinkFeed').innerHTML=S.drinks.length?S.drinks.map(d=>{const p=participant(d.participant_id),date=tripDateFromISO(d.consumed_at),mins=tripTimeMinutes(d.consumed_at),time=`${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`,n=Number(d.beer)+Number(d.wine)+Number(d.spirits),types=[d.beer?`pivo ${d.beer}`:'',d.wine?`víno ${d.wine}`:'',d.spirits?`panák ${d.spirits}`:''].filter(Boolean).join(' · ');return `<div class="feed-row"><span>${avatarHTML(p,'m')}</span><span class="feed-copy"><b>${esc(p?.name||'')}${d.is_test?' <span class="test-pill">TEST</span>':''}</b><small>${dateLabel(date)} ${time} · ${esc(occasionLabel(d.occasion))} · ${esc(types)}</small></span><span class="feed-value">${n}<small>drinkov</small></span><button class="icon-button drink-delete" data-id="${d.id}">${icon('trash')}</button></div>`;}).join(''):`<div class="empty">Zatiaľ nič. Sober je tiež skóre.</div>`;$$('.drink-delete').forEach(b=>b.onclick=async()=>{if(!confirm('Zmazať tento zápis?'))return;const{error}=await S.client.from('drinks').delete().eq('id',b.dataset.id);if(error)return toast(error.message,true);await loadAllData();});hydrateAvatars($('tab-drinks'));}

/* ---------- Badges ---------- */
function renderBadges(st){
  const defs=computeBadges(st),dated=[]; defs.forEach(b=>b.earners.forEach(e=>{if(e.date)dated.push({badge:b,earner:e});})); dated.sort((a,b)=>String(b.earner.date).localeCompare(String(a.earner.date)));
  const unlocked=defs.filter(b=>b.earners.length), f=dated[0]||(unlocked[0]?.earners[0]?{badge:unlocked[0],earner:unlocked[0].earners[0]}:null);
  $('featuredBadge').innerHTML=f?`<button class="featured-card badge-open" data-badge-open="${f.badge.id}"><div class="badge-medallion ${f.badge.tier}">${icon(f.badge.icon)}</div><p class="eyebrow">ODZNAK DŇA</p><h2>${esc(f.badge.title)}</h2><p>${esc(f.badge.description)} ${f.earner?`· ${esc(participant(f.earner.participantId)?.name||'')}${badgePersonSuffix(f.badge,f.earner.participantId)}`:''}</p></button>`:`<div class="card empty">Odznaky sa odomknú počas výpravy.</div>`;
  const latest=dated.slice(0,4); $('latestBadges').innerHTML=latest.length?latest.map(x=>{const p=participant(x.earner.participantId);return `<button class="latest-badge badge-open" data-badge-open="${x.badge.id}">${avatarHTML(p,'m')}<span><b>${esc(p?.name||'')}</b><small>${esc(x.badge.title)}${badgePersonSuffix(x.badge,x.earner.participantId)} · ${dateLabel(x.earner.date)}</small></span><span class="mini-medallion ${x.badge.tier}">${icon(x.badge.icon)}</span></button>`;}).join(''):`<div class="empty compact">Zatiaľ bez časovaných odznakov.</div>`;
  const fams=['Riding','Mishaps','Recovery & drinks','Trip & money']; $('badgeFamilies').innerHTML=fams.map(fam=>`<section class="badge-family card"><div class="card-head"><h2>${esc(fam)}</h2><span class="count-pill">${defs.filter(b=>b.family===fam).length}</span></div><div class="badge-grid">${defs.filter(b=>b.family===fam).map(renderBadgeCard).join('')}</div></section>`).join('');
  $('badgePeople').innerHTML=`<section class="card"><div class="people-badge-list">${S.participants.map(p=>{const pb=personBadges(p.id,st);return `<button class="person-badge-row" data-person-badges="${p.id}">${avatarHTML(p,'l')}<span class="copy"><b>${esc(p.name)}</b><small>${pb.length} / ${defs.length} odznakov</small><span class="person-mini-badges">${pb.slice(0,4).map(b=>`<i class="mini-medallion ${b.tier}">${icon(b.icon)}</i>`).join('')}${pb.length>4?`<em>+${pb.length-4}</em>`:''}</span></span>${icon('chevron','feed-chevron')}</button>`;}).join('')}</div></section>`;
  const applyMode=()=>{$('badgeCatalog').hidden=S.badgeMode!=='catalog';$('badgePeople').hidden=S.badgeMode!=='people';$('badgeCatalogBtn').classList.toggle('active',S.badgeMode==='catalog');$('badgePeopleBtn').classList.toggle('active',S.badgeMode==='people');}; applyMode();
  $('badgeCatalogBtn').onclick=()=>{S.badgeMode='catalog';applyMode();}; $('badgePeopleBtn').onclick=()=>{S.badgeMode='people';applyMode();};
  $$('[data-badge-open]',$('tab-badges')).forEach(b=>b.onclick=()=>openBadgeSheet(b.dataset.badgeOpen)); $$('[data-person-badges]',$('tab-badges')).forEach(b=>b.onclick=()=>openPersonBadges(b.dataset.personBadges)); hydrateAvatars($('tab-badges'));
}
function mishapLevel(count){const n=Number(count)||0;return n>=3?'Gold III':n===2?'Gold II':'Gold I';}
function badgePersonSuffix(b,id){const e=b.earners.find(x=>x.participantId===id);if(!e)return'';if(b.tier==='platinum')return' · Platinum';if(b.progression==='mishap')return` · ${mishapLevel(e.count)} ×${e.count}`;return'';}
function renderBadgeCard(b){const unlocked=b.earners.length>0;const earners=unlocked?b.earners.slice(0,6).map(e=>{const p=participant(e.participantId);const tier=b.tier==='platinum'?'Platinum':b.progression==='mishap'?`${mishapLevel(e.count)} ×${e.count}`:'';const lvl=b.progression==='mishap'?` level-${Math.min(3,Number(e.count)||1)}`:'';return `<span class="badge-earner${lvl}">${avatarHTML(p,'s')}<span><b>${esc(p?.name||'')}</b>${tier?`<small>${esc(tier)}</small>`:''}</span></span>`;}).join(''):`<span>zamknuté</span>`;return `<button type="button" data-badge-open="${b.id}" class="badge-card ${unlocked?'':'locked'}"><div class="badge-card-head"><div class="badge-medallion ${b.tier}">${icon(b.icon)}</div><div><h3>${esc(b.title)}</h3><p>${esc(b.description)}</p></div></div><div class="earners">${earners}</div></button>`;}
function openBadgeSheet(id){const st=computeStats(),b=computeBadges(st).find(x=>x.id===id);if(!b)return;$('badgeSheetTitle').textContent=b.title;$('badgeSheetIcon').innerHTML=icon(b.icon);$('badgeSheetContent').innerHTML=`<div class="badge-detail-head"><div class="badge-medallion ${b.tier}">${icon(b.icon)}</div><div><p class="eyebrow dark">${esc(b.family)}</p><h3>${esc(b.title)}</h3><p>${esc(b.description)}</p></div></div><div class="badge-detail-earners">${b.earners.length?b.earners.map(e=>{const p=participant(e.participantId);return `<div class="badge-detail-person">${avatarHTML(p,'m')}<span><b>${esc(p?.name||'')}</b><small>${e.date?dateLabel(e.date):'odomknuté'}${badgePersonSuffix(b,e.participantId)}</small></span></div>`;}).join(''):`<div class="empty">Tento odznak zatiaľ nikto nemá.</div>`}</div>`;hydrateAvatars($('badgeSheetContent'));openSheet('badgeSheet');}
function openPersonBadges(id){const st=computeStats(),p=participant(id),pb=personBadges(id,st),x=st[id];if(!p)return;$('badgeSheetTitle').textContent=p.name;$('badgeSheetIcon').innerHTML=icon('user');$('badgeSheetContent').innerHTML=`<div class="person-badge-profile">${avatarHTML(p,'xl')}<div><h3>${esc(p.name)}</h3><p>${pb.length} odznakov · ${x?.score||0} bodov · ${round(x?.elev||0)} m</p></div></div><div class="person-badge-grid">${pb.length?pb.map(b=>`<button class="person-badge-chip" data-badge-open-sheet="${b.id}"><span class="mini-medallion ${b.tier}">${icon(b.icon)}</span><span><b>${esc(b.title)}</b><small>${esc(b.family)}${badgePersonSuffix(b,id)}</small></span></button>`).join(''):`<div class="empty">Zatiaľ bez odznakov.</div>`}</div>`;hydrateAvatars($('badgeSheetContent'));$$('[data-badge-open-sheet]',$('badgeSheetContent')).forEach(b=>b.onclick=()=>openBadgeSheet(b.dataset.badgeOpenSheet));openSheet('badgeSheet');}

/* ---------- Settings ---------- */
function renderSettings(){const admin=S.me?.role==='admin';$$('.admin-only').forEach(x=>x.hidden=!admin);renderStaySettings();if(admin){renderAdminSettings();renderParticipantSettings();renderCurrencySettings();renderTripSettings();}renderAccountSettings();}
function renderStaySettings(){$('staySettings').innerHTML=`<div class="stay-list">${S.participants.map(p=>`<article class="stay-card" data-stay="${p.id}"><div class="stay-head">${avatarHTML(p,'m')}<div><b>${esc(p.name)}</b><small>${esc(p.email)}</small></div></div><div class="stay-dates"><label>Príchod<input type="date" data-arrival value="${esc(p.arrival_date||'')}"></label><label>Odchod<input type="date" data-departure value="${esc(p.departure_date||'')}"></label></div><div class="stay-foot"><span>${nightsFor(p)} nocí</span><button class="secondary" data-save-stay="${p.id}">Uložiť</button></div></article>`).join('')}</div>`;$$('[data-save-stay]').forEach(b=>b.onclick=()=>saveStay(b.dataset.saveStay));hydrateAvatars($('staySettings'));}
async function saveStay(id){const c=document.querySelector(`[data-stay="${id}"]`);try{const{error}=await S.client.rpc('update_participant_stay',{p_participant_id:id,p_arrival:c.querySelector('[data-arrival]').value||null,p_departure:c.querySelector('[data-departure]').value||null});if(error)throw error;await loadAllData();toast('Pobyt uložený.');}catch(err){toast(err.message,true);}}
function renderParticipantSettings(){$('participantSettings').innerHTML=`<p class="admin-note">Každý účastník si môže zmeniť vlastnú profilovú fotku v sekcii <b>Účet</b>. Po importe vymeň dočasné <b>@pending.local</b> adresy za skutočné Google e-maily.</p><form id="newParticipantForm"><div class="form-grid two"><label>Meno<input id="npName" required></label><label>Google e-mail<input id="npEmail" type="email" required></label></div><div class="form-grid two"><label>Príchod<input id="npArrival" type="date" value="${esc(S.trip.start_date)}"></label><label>Odchod<input id="npDeparture" type="date" value="${esc(S.trip.end_date)}"></label></div><label>Rola<select id="npRole"><option value="member">Člen</option><option value="admin">Admin</option></select></label><button class="primary full" type="submit">${icon('plus')}Pridať účastníka</button></form><div class="settings-list" style="margin-top:12px">${S.participants.map(p=>`<div class="settings-row" data-part-row="${p.id}"><div class="settings-row-head">${avatarHTML(p,'m')}<div class="copy"><b>${esc(p.name)}</b><small>${esc(p.email)} · ${esc(p.role)}</small></div><button class="secondary" data-part-edit="${p.id}">Upraviť</button></div><div class="part-edit" hidden></div></div>`).join('')}</div>`;$('newParticipantForm').onsubmit=addParticipant;$$('[data-part-edit]').forEach(b=>b.onclick=()=>toggleParticipantEdit(b.dataset.partEdit));hydrateAvatars($('participantSettings'));}
async function addParticipant(e){e.preventDefault();try{const{error}=await S.client.from('participants').insert({trip_id:S.tripId,name:$('npName').value.trim(),email:$('npEmail').value.trim().toLowerCase(),role:$('npRole').value,arrival_date:$('npArrival').value||null,departure_date:$('npDeparture').value||null});if(error)throw error;await loadAllData();toast('Účastník pridaný.');}catch(err){toast(err.message,true);}}
function toggleParticipantEdit(id){const row=document.querySelector(`[data-part-row="${id}"]`),box=row.querySelector('.part-edit'),p=participant(id);if(!box.hidden){box.hidden=true;box.innerHTML='';return;}box.hidden=false;box.innerHTML=`<div class="form-grid two" style="margin-top:10px"><label>Meno<input data-pe-name value="${esc(p.name)}"></label><label>E-mail<input data-pe-email value="${esc(p.email)}"></label></div><label>Rola<select data-pe-role><option value="member" ${p.role==='member'?'selected':''}>Člen</option><option value="admin" ${p.role==='admin'?'selected':''}>Admin</option></select></label><div class="sheet-mode-actions"><button class="primary" data-pe-save="${id}">Uložiť</button></div>`;box.querySelector('[data-pe-save]').onclick=()=>saveParticipantEdit(id);}
async function saveParticipantEdit(id){const row=document.querySelector(`[data-part-row="${id}"]`);try{const{error}=await S.client.from('participants').update({name:row.querySelector('[data-pe-name]').value.trim(),email:row.querySelector('[data-pe-email]').value.trim().toLowerCase(),role:row.querySelector('[data-pe-role]').value}).eq('id',id).eq('trip_id',S.tripId);if(error)throw error;await loadAllData();toast('Účastník upravený.');}catch(err){toast(err.message,true);}}
function renderCurrencySettings(){$('currencySettings').innerHTML=`<div class="settings-list">${S.currencies.map(c=>`<div class="settings-row"><div class="settings-row-head"><div class="copy"><b>${esc(c.code)}</b><small>1 ${esc(c.code)} = x EUR</small></div><input data-rate="${c.id}" type="number" step="0.000001" min="0" value="${esc(c.rate_to_eur)}" style="width:120px;margin:0"><button class="secondary" data-save-rate="${c.id}">Uložiť</button></div></div>`).join('')}</div><form id="newCurrencyForm" class="inline-form"><input id="newCurrencyCode" placeholder="GBP" maxlength="5"><input id="newCurrencyRate" type="number" step="0.000001" min="0" placeholder="EUR kurz"><button class="primary" type="submit">${icon('plus')}</button></form>`;$$('[data-save-rate]').forEach(b=>b.onclick=()=>saveRate(b.dataset.saveRate));$('newCurrencyForm').onsubmit=addCurrency;}
async function saveRate(id){const c=S.currencies.find(x=>x.id===id),v=Number(document.querySelector(`[data-rate="${id}"]`).value);if(c.code==='EUR'&&v!==1)return toast('EUR musí zostať 1.',true);const{error}=await S.client.from('currencies').update({rate_to_eur:v}).eq('id',id);if(error)return toast(error.message,true);await loadAllData();toast('Kurz uložený.');}
async function addCurrency(e){e.preventDefault();const code=$('newCurrencyCode').value.trim().toUpperCase(),v=Number($('newCurrencyRate').value);if(!code||!(v>0))return toast('Zadaj menu a kladný kurz.',true);const{error}=await S.client.from('currencies').insert({trip_id:S.tripId,code,rate_to_eur:v});if(error)return toast(error.message,true);await loadAllData();}
function renderTripSettings(){const cover=S.tripCoverUrl||'assets/hero-more.webp';$('tripSettings').innerHTML=`<label>Názov<input id="tripName" value="${esc(S.trip.name)}"></label><div class="form-grid two"><label>Začiatok<input id="tripStart" type="date" value="${esc(S.trip.start_date)}"></label><label>Koniec<input id="tripEnd" type="date" value="${esc(S.trip.end_date)}"></label></div><div class="trip-cover-editor"><div class="trip-cover-preview" style="background-image:url('${esc(cover)}')"><span>Fotka výpravy</span></div><div class="media-actions"><label class="secondary media-picker">${icon('camera')} Zmeniť<input id="tripCoverFile" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>${S.tripCoverUrl?`<button class="danger" id="removeTripCover" type="button">${icon('trash')}</button>`:''}</div><p class="media-hint">Fotka sa oreže na široký formát a uloží súkromne v Supabase Storage.</p></div><button class="primary full" id="saveTrip">${icon('save')}Uložiť výpravu</button>`;$('saveTrip').onclick=saveTrip;$('tripCoverFile').onchange=e=>{const f=e.target.files?.[0];if(f)uploadTripCover(f);};if($('removeTripCover'))$('removeTripCover').onclick=removeTripCover;}
async function saveTrip(){const payload={name:$('tripName').value.trim(),start_date:$('tripStart').value,end_date:$('tripEnd').value};const{error}=await S.client.from('trips').update(payload).eq('id',S.tripId);if(error)return toast(error.message,true);await loadAllData();toast('Výprava uložená.');}
function renderAccountSettings(){const hasAvatar=!!S.avatarUrls[S.me?.id];const iban=normalizeIBAN(S.me?.iban);$('accountSettings').innerHTML=`<div class="profile-editor"><div class="profile-photo-wrap">${avatarHTML(S.me,'xl')}<span class="profile-camera">${icon('camera')}</span></div><div class="copy"><b>${esc(S.me?.name||S.session?.user?.email||'')}</b><small>${esc(S.session?.user?.email||'')} · ${esc(S.me?.role||'member')}</small></div></div><div class="media-actions profile-media-actions"><label class="primary media-picker">${icon('camera')} ${hasAvatar?'Zmeniť fotku':'Pridať fotku'}<input id="avatarFile" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>${hasAvatar?`<button class="secondary" id="removeAvatarBtn" type="button">${icon('trash')} Odstrániť</button>`:''}</div><p class="media-hint">Môžeš vybrať ľubovoľnú fotku. Appka ju automaticky oreže na štvorec a zmenší.</p><div class="iban-account"><div class="iban-row"><label>IBAN pre vyrovnanie platieb<input id="myIban" inputmode="text" autocomplete="off" maxlength="42" placeholder="SK00 0000 0000 0000 0000 0000" value="${esc(formatIBAN(iban))}"></label><button class="secondary" id="saveIbanBtn" type="button">${icon('save')} Uložiť</button></div><p class="media-hint">IBAN uvidia iba členovia tejto výpravy pri vyrovnaní nákladov. Môžeš ho kedykoľvek zmeniť alebo vymazať.</p></div><button class="secondary full" id="signOutBtn" style="width:100%;margin-top:14px">${icon('logout')} Odhlásiť</button>`;$('avatarFile').onchange=e=>{const f=e.target.files?.[0];if(f)uploadMyAvatar(f);};if($('removeAvatarBtn'))$('removeAvatarBtn').onclick=removeMyAvatar;$('saveIbanBtn').onclick=saveMyIban;$('myIban').addEventListener('blur',e=>{e.target.value=formatIBAN(e.target.value);});$('signOutBtn').onclick=()=>S.client.auth.signOut();hydrateAvatars($('accountSettings'));}
async function saveMyIban(){try{const raw=$('myIban').value.trim(),iban=normalizeIBAN(raw);if(iban && !validIBAN(iban))throw new Error('IBAN nevyzerá platne. Skontroluj číslo účtu.');const{error}=await S.client.rpc('update_my_iban',{p_trip_id:S.tripId,p_iban:iban||null});if(error)throw error;await loadAllData();toast(iban?'IBAN uložený.':'IBAN odstránený.');}catch(err){toast(err.message,true);}}


/* ---------- Admin ---------- */
function scoreField(key,label,value,step='1'){return `<label>${esc(label)}<input data-score-key="${esc(key)}" type="number" min="0" step="${step}" value="${esc(value)}"></label>`;}
function renderAdminSettings(){
  const cfg=scoreSettings(), testRides=(S.allRides||[]).filter(x=>x.is_test).length, testDrinks=(S.allDrinks||[]).filter(x=>x.is_test).length;
  $('adminSettings').innerHTML=`
    <div class="admin-block"><div class="admin-block-head"><div><p class="eyebrow dark">ZOBRAZENIE</p><h3>Sekcie a test dáta</h3></div></div>
      <label class="toggle-row"><span><b>Kúpeľňa</b><small>Skryje alebo zobrazí sekciu všetkým.</small></span><input id="adminBathroomToggle" type="checkbox" ${S.trip.show_bathroom?'checked':''}><i></i></label>
      <label class="toggle-row"><span><b>Testovacie dáta</b><small>TEST jazdy a drinky sa započítajú iba keď je zapnuté.</small></span><input id="adminTestToggle" type="checkbox" ${S.trip.show_test_data?'checked':''}><i></i></label>
    </div>
    <div class="admin-block"><div class="admin-block-head"><div><p class="eyebrow dark">BODOVANIE</p><h3>Hodnoty Calpe Cup</h3></div><button class="secondary compact" id="resetScores" type="button">Predvolené</button></div>
      <div class="score-admin-grid">
        ${scoreField('distance_km_per_point','Km na 1 bod',cfg.distance_km_per_point,'1')}
        ${scoreField('elevation_m_per_point','Metre na 1 bod',cfg.elevation_m_per_point,'10')}
        ${scoreField('drink_points','Bodov za drink',cfg.drink_points,'1')}
        ${scoreField('crash_points','Pád',cfg.crash_points,'1')}
        ${scoreField('puncture_points','Defekt',cfg.puncture_points,'1')}
        ${scoreField('mechanical_points','Mechanika',cfg.mechanical_points,'1')}
        ${scoreField('sober_day_points','Sober deň',cfg.sober_day_points,'1')}
        ${scoreField('sober_trip_points','Celý trip sober',cfg.sober_trip_points,'1')}
      </div>
      <p class="admin-note">Pódiá</p><div class="score-podium-grid"><div><b>Šprint</b>${scoreField('sprint_first','1.',cfg.sprint_first)}${scoreField('sprint_second','2.',cfg.sprint_second)}${scoreField('sprint_third','3.',cfg.sprint_third)}</div><div><b>Kopec</b>${scoreField('hill_first','1.',cfg.hill_first)}${scoreField('hill_second','2.',cfg.hill_second)}${scoreField('hill_third','3.',cfg.hill_third)}</div></div>
      <button class="primary full" id="saveAdminSettings" type="button">${icon('save')} Uložiť nastavenia</button>
    </div>
    <div class="admin-block"><div class="admin-block-head"><div><p class="eyebrow dark">TEST DÁTA</p><h3>Demo obsah</h3></div><span class="count-pill">${testRides} jázd · ${testDrinks} drinkov</span></div>
      <p class="admin-note">Vytvorí ukážkové jazdy, pódiá, mishapy a drinky označené TEST. Reálne výdavky ani používateľov nemení.</p>
      <div class="admin-actions"><button class="secondary" id="generateTestData" type="button">Vygenerovať test dáta</button><button class="danger" id="clearTestData" type="button">Zmazať test dáta</button></div>
    </div>`;
  $('saveAdminSettings').onclick=saveAdminSettings; $('resetScores').onclick=()=>{S.trip.score_settings={...DEFAULT_SCORE};renderAdminSettings();};
  $('generateTestData').onclick=generateTestData; $('clearTestData').onclick=clearTestData;
}
async function saveAdminSettings(){
  try{const cfg={...DEFAULT_SCORE};$$('[data-score-key]',$('adminSettings')).forEach(i=>cfg[i.dataset.scoreKey]=Number(i.value));
    if(!(cfg.distance_km_per_point>0)||!(cfg.elevation_m_per_point>0))throw new Error('Km a metre na bod musia byť väčšie ako nula.');
    const payload={show_bathroom:$('adminBathroomToggle').checked,show_test_data:$('adminTestToggle').checked,score_settings:cfg};
    const{error}=await S.client.from('trips').update(payload).eq('id',S.tripId);if(error)throw error;await loadAllData();toast('Administrácia uložená.');
  }catch(err){toast(err.message,true);}
}
async function generateTestData(){if(!confirm('Vygenerovať ukážkové TEST jazdy a drinky? Existujúce TEST dáta sa nahradia.'))return;try{const{error}=await S.client.rpc('generate_test_data',{p_trip_id:S.tripId});if(error)throw error;await loadAllData();toast('Test dáta vygenerované.');}catch(err){toast(err.message,true);}}
async function clearTestData(){if(!confirm('Zmazať všetky TEST jazdy a drinky?'))return;try{const{error}=await S.client.rpc('clear_test_data',{p_trip_id:S.tripId});if(error)throw error;await loadAllData();toast('Test dáta zmazané.');}catch(err){toast(err.message,true);}}


/* ---------- Sheets ---------- */
function openSheet(id){$('sheetBackdrop').classList.add('show');$(id).classList.add('show');$(id).setAttribute('aria-hidden','false');document.body.classList.add('sheet-open');}
function closeSheets(){$('sheetBackdrop').classList.remove('show');$$('.bottom-sheet').forEach(x=>{x.classList.remove('show');x.setAttribute('aria-hidden','true');});document.body.classList.remove('sheet-open');S.rideEditing=false;}

init();
})();
