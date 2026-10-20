let state={data:null,refreshing:true,error:null,pinned:true};
const $=selector=>document.querySelector(selector);
const numbers=new Intl.NumberFormat('ja-JP',{maximumFractionDigits:1});
$('#refresh').addEventListener('click',()=>window.codexUsage.refresh());
$('#pin').addEventListener('click',()=>window.codexUsage.pin());
$('#hide').addEventListener('click',()=>window.codexUsage.hide());
window.codexUsage.onState(value=>{state=value;render();});window.codexUsage.ready();
setInterval(()=>renderStatus(),1000);
function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;}
function quotaCard(value,fallback){
  const card=element('article','quota');card.dataset.level=!value?'unknown':value.remainingPercent<=10?'danger':value.remainingPercent<=20?'warning':'ok';card.append(element('h2',null,value?.label||fallback));
  const pending=!state.data&&state.refreshing;
  const amount=element('p','amount');amount.append(element('span','number',value?numbers.format(value.remainingPercent):pending?'確認中…':'取得不可'));if(value)amount.append(element('span','unit','%'));card.append(amount,element('p','remaining',value?'残っています':pending?'取得しています':'残量データがありません'));
  const track=element('div','track'),fill=element('div','fill');fill.style.width=value?`${value.remainingPercent}%`:'0%';track.append(fill);card.append(track);
  const reset=element('p','reset');if(value?.resetsAt){const date=new Date(value.resetsAt*1000);reset.textContent=date.getTime()<=Date.now()?'リセット時刻経過・更新待ち':`リセット ${date.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`;}else reset.textContent='リセット時刻は取得不可';card.append(reset);return card;
}
function render(){
  const buckets=$('#buckets');buckets.replaceChildren();const items=state.data?.buckets||[{id:'codex',title:'Codex',primary:null,secondary:null}];
  for(const bucket of items){const section=element('section','bucket');if(items.length>1)section.append(element('h2','bucket-title',bucket.title));const grid=element('div','quota-grid');const windows=[bucket.primary,bucket.secondary].filter(Boolean);if(windows.length===0)grid.append(quotaCard(null,'利用枠'));else for(const value of windows)grid.append(quotaCard(value,'利用枠'));grid.classList.toggle('single',windows.length<2);section.append(grid);if(state.data&&windows.length<2)section.append(element('p','availability','取得できた利用枠を表示しています。その他の枠の情報は提供されていません。'));buckets.append(section);}
  const credit=state.data?.credits,value=$('#credits');value.classList.toggle('unknown',credit?.kind!=='balance');
  value.removeAttribute('title');
  if(credit?.kind==='balance'){const [whole,fraction]=credit.balance.split('.');value.textContent=whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?'.'+fraction.slice(0,2):'');value.title=credit.balance;$('#credit-note').textContent=fraction?.length>2?'クレジット · 小数第2位まで表示（詳細は数値にマウスを重ねて確認）':'クレジット';}
  else if(credit?.kind==='unlimited'){value.textContent='上限なし';$('#credit-note').textContent='Codexから上限なしの情報が返されています';}
  else{value.textContent=state.data?'取得不可':state.refreshing?'取得中…':'取得不可';$('#credit-note').textContent=state.data?'残高情報が提供されていません':state.refreshing?'残高情報を確認しています':'まだ残高を取得できていません';}
  $('#plan').textContent=state.data?.plan?state.data.plan.replace(/^./,x=>x.toUpperCase()):'';
  $('#pin').setAttribute('aria-pressed',String(state.pinned));$('#refresh').disabled=state.refreshing;$('#refresh').textContent=state.refreshing?'更新中…':'更新';
  $('#error').hidden=!state.error;$('#error').textContent=state.error?`${state.error}${state.data?'。前回取得した値を表示しています。':'。「更新」で再取得できます。'}`:'';renderStatus();
}
function renderStatus(){if(state.refreshing){$('#status').textContent='残量を確認しています…';return;}if(!state.data){$('#status').textContent='まだ取得できていません';return;}const date=new Date(state.data.updatedAt),stale=state.error||Date.now()-date.getTime()>600000;$('#status').textContent=`${stale?'前回の値':'取得済み'} · ${date.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})} 更新`;}
render();
