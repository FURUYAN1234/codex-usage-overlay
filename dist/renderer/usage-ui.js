let state={data:null,refreshing:true,error:null,pinned:true};
const $=selector=>document.querySelector(selector);
const numbers=new Intl.NumberFormat('ja-JP',{maximumFractionDigits:1});
const resetTime=new Intl.DateTimeFormat('en-GB',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const updateTime=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit'});
const unavailable='Unavailable / 取得不可';

$('#refresh').addEventListener('click',()=>window.codexUsage.refresh());
$('#pin').addEventListener('click',()=>window.codexUsage.pin());
$('#hide').addEventListener('click',()=>window.codexUsage.hide());
window.codexUsage.onState(value=>{state=value;render();});
window.codexUsage.ready();
setInterval(renderStatus,1000);

function element(tag,className,text){
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!=null)node.textContent=text;
  return node;
}
function quotaCard(value){
  const card=element('article','quota');
  card.dataset.level=!value?'unknown':value.remainingPercent<=10?'danger':value.remainingPercent<=20?'warning':'ok';
  card.append(element('h2',null,value?.label||'Usage window / 利用枠'));

  const pending=!state.data&&state.refreshing;
  const amount=element('p','amount');
  amount.append(element('span','number',value?numbers.format(value.remainingPercent):pending?'Checking… / 確認中…':unavailable));
  if(value)amount.append(element('span','unit','%'));
  const remaining=value?'Remaining / 残り':pending?'Fetching usage / 利用枠を取得しています':'No usage data / 残量データがありません';
  card.append(amount,element('p','remaining',remaining));

  const track=element('div','track'),fill=element('div','fill');
  fill.style.width=value?`${value.remainingPercent}%`:'0%';
  track.append(fill);
  card.append(track);

  const reset=element('p','reset');
  if(value?.resetsAt){
    const date=new Date(value.resetsAt*1000);
    reset.textContent=date.getTime()<=Date.now()
      ? 'Reset passed, awaiting refresh / リセット時刻経過、更新待ち'
      : `Reset / リセット ${resetTime.format(date)}`;
  }else reset.textContent='Reset time unavailable / リセット時刻は取得不可';
  card.append(reset);
  return card;
}
function render(){
  const buckets=$('#buckets');
  buckets.replaceChildren();
  const items=state.data?.buckets||[{id:'codex',title:'Codex',primary:null,secondary:null}];
  for(const bucket of items){
    const section=element('section','bucket');
    if(items.length>1)section.append(element('h2','bucket-title',bucket.title));
    const grid=element('div','quota-grid');
    const windows=[bucket.primary,bucket.secondary].filter(Boolean);
    if(windows.length===0)grid.append(quotaCard(null));
    else for(const value of windows)grid.append(quotaCard(value));
    grid.classList.toggle('single',windows.length<2);
    section.append(grid);
    if(state.data&&windows.length<2){
      section.append(element('p','availability','Other usage windows are unavailable. / その他の利用枠の情報は提供されていません。'));
    }
    buckets.append(section);
  }

  const credit=state.data?.credits,value=$('#credits'),note=$('#credit-note');
  value.classList.toggle('unknown',credit?.kind!=='balance');
  value.removeAttribute('title');
  if(credit?.kind==='balance'){
    const [whole,fraction]=credit.balance.split('.');
    value.textContent=whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?'.'+fraction.slice(0,2):'');
    value.title=credit.balance;
    note.textContent=fraction?.length>2?'Hover for the full balance. / 数値にマウスを重ねると全桁を表示します。':'Credits / クレジット';
  }else if(credit?.kind==='unlimited'){
    value.textContent='Unlimited / 上限なし';
    note.textContent='Codex reports unlimited credits. / Codexから上限なしの情報が返されています。';
  }else{
    value.textContent=!state.data&&state.refreshing?'Loading… / 取得中…':unavailable;
    note.textContent=state.data?'Codex did not return a balance. / 残高情報が提供されていません。'
      :state.refreshing?'Checking balance / 残高を確認しています':'No balance fetched yet. / まだ残高を取得できていません。';
  }

  $('#plan').textContent=state.data?.plan?state.data.plan.replace(/^./,x=>x.toUpperCase()):'';
  $('#pin').setAttribute('aria-pressed',String(state.pinned));
  $('#refresh').disabled=state.refreshing;
  $('#refresh').textContent=state.refreshing?'Refreshing… / 更新中…':'Refresh / 更新';
  const error=$('#error');
  error.hidden=!state.error;
  const nextStep=state.data?'Showing the last values. / 前回取得した値を表示しています。':'Use Refresh to try again. / 「更新」で再取得できます。';
  error.textContent=state.error?`${state.error}\n${nextStep}`:'';
  renderStatus();
}
function renderStatus(){
  const status=$('#status');
  if(state.refreshing){status.textContent='Checking usage… / 残量を確認しています…';return;}
  if(!state.data){status.textContent='No data yet / まだ取得できていません';return;}
  const date=new Date(state.data.updatedAt);
  const stale=state.error||Date.now()-date.getTime()>600000;
  status.textContent=`${stale?'Last values / 前回の値':'Updated / 取得済み'} · ${updateTime.format(date)}`;
}
render();
