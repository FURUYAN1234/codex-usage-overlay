import {app,ipcMain,Menu,nativeImage,Tray,globalShortcut} from 'electron';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {getConfig,updateConfig} from '../config/store.js';
import {readAccountUsage} from '../monitor/account-usage.js';
import {createUsageWindow} from './usage-window.js';
let win,tray,timer;
let quitting=false,inFlight=null,verified=false;
let state={data:null,refreshing:false,error:null,pinned:true};
let refreshRequests=0,successfulReads=0;
const controller=new AbortController();
function publish(){if(win&&!win.isDestroyed())win.webContents.send('usage:state',state);}
function allowed(event){return event.sender===win?.webContents&&event.senderFrame?.url===win.webContents.getURL();}
function togglePin(){state.pinned=!win.isAlwaysOnTop();win.setAlwaysOnTop(state.pinned);const config=getConfig();updateConfig({ui:{...config.ui,alwaysOnTop:state.pinned}});publish();rebuildTray();}
async function refresh(){
  if(inFlight)return inFlight;
  state={...state,refreshing:true};publish();
  inFlight=(async()=>{
    try{const data=await readAccountUsage({signal:controller.signal});successfulReads++;state={...state,data,error:null};}
    catch(error){state={...state,error:error.code==='missing'?'Codexが見つかりません':error.code==='timeout'?'取得がタイムアウトしました':'Codexの残量を取得できませんでした'};}
    finally{state={...state,refreshing:false};inFlight=null;publish();}
    await verifyOnce();
  })();return inFlight;
}
function rebuildTray(){tray.setContextMenu(Menu.buildFromTemplate([
  {label:'残量を表示',click:()=>{win.show();win.focus();}},
  {label:'今すぐ更新',click:()=>void refresh()},
  {label:'常に手前に表示',type:'checkbox',checked:state.pinned,click:togglePin},
  {label:'画面中央に戻す',click:()=>{win.center();win.show();win.focus();}},
  {type:'separator'},{label:'終了',click:()=>app.quit()}
]));}
function trayImage(){
  const pixels=Buffer.alloc(32*32*4);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){
    const bar=(x>=7&&x<=10&&y>=17&&y<=24)||(x>=14&&x<=17&&y>=8&&y<=24)||(x>=21&&x<=24&&y>=13&&y<=24);
    const i=(y*32+x)*4;pixels[i]=bar?255:183;pixels[i+1]=bar?255:102;pixels[i+2]=bar?255:38;pixels[i+3]=255;
  }return nativeImage.createFromBitmap(pixels,{width:32,height:32});
}
async function verifyOnce(){
  const directory=process.env.CODEX_USAGE_VERIFY_DIR;
  if(!directory||verified||!win||!win.isVisible())return;
  verified=true;await mkdir(directory,{recursive:true});
  const pause=()=>new Promise(resolve=>setTimeout(resolve,120));
  const inspect=()=>win.webContents.executeJavaScript(`({title:document.title,text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth,refreshDisabled:document.querySelector('#refresh').disabled,quotaCount:document.querySelectorAll('.quota').length,numbers:[...document.querySelectorAll('.number')].map(e=>e.textContent),credits:document.querySelector('#credits').textContent,errorVisible:!document.querySelector('#error').hidden,status:document.querySelector('#status').textContent,pin:document.querySelector('#pin').getAttribute('aria-pressed')})`);
  const checks={};let failure=null;const originalPin=state.pinned,originalVisible=win.isVisible();
  try{
    await pause();let ui=await inspect();
    const windows=state.data?.buckets.flatMap(bucket=>[bucket.primary,bucket.secondary].filter(Boolean))||[];
    checks.liveNumbers=windows.length>0&&windows.every((value,index)=>ui.numbers[index]===new Intl.NumberFormat('ja-JP',{maximumFractionDigits:1}).format(value.remainingPercent));
    checks.liveLayout=!ui.overflow&&!ui.refreshDisabled&&ui.quotaCount===windows.length;
    const liveState=structuredClone(state);
    const fixture=async value=>{win.webContents.send('usage:state',value);await pause();return inspect();};
    ui=await fixture({data:null,refreshing:true,error:null,pinned:state.pinned});checks.loading=ui.text.includes('確認中…')&&!ui.text.includes('100');
    ui=await fixture({data:null,refreshing:false,error:'取得テスト',pinned:state.pinned});checks.missing=ui.text.includes('取得不可')&&!ui.numbers.includes('100')&&ui.errorVisible;
    ui=await fixture({...liveState,error:'接続失敗の検証用表示'});checks.stale=ui.status.includes('前回の値')&&ui.errorVisible;
    const example={...liveState,data:{...liveState.data,buckets:[{id:'fixture',title:'test',primary:{label:'5時間枠',remainingPercent:8,resetsAt:null},secondary:{label:'週間枠',remainingPercent:0,resetsAt:null}}],credits:{kind:'balance',balance:'0'}}};
    ui=await fixture(example);checks.twoWindows=ui.quotaCount===2&&ui.numbers.join(',')==='8,0'&&ui.credits==='0'&&!ui.overflow;
    ui=await fixture({...example,data:{...example.data,credits:{kind:'balance',balance:'12345.678900'}}});checks.creditFormat=ui.credits==='12,345.67';
    ui=await fixture({...example,data:{...example.data,credits:{kind:'unlimited'}}});checks.unlimited=ui.credits==='上限なし';
    publish();await pause();
    const pinned=state.pinned;await win.webContents.executeJavaScript(`document.querySelector('#pin').click()`);await pause();checks.pin=win.isAlwaysOnTop()!==pinned&&(await inspect()).pin===String(!pinned);
    await win.webContents.executeJavaScript(`document.querySelector('#pin').click()`);await pause();checks.pinRestored=win.isAlwaysOnTop()===pinned;
    await win.webContents.executeJavaScript(`document.querySelector('#hide').click()`);await pause();checks.hide=!win.isVisible();win.show();win.focus();await pause();checks.show=win.isVisible();
    const before=refreshRequests,readsBefore=successfulReads;await win.webContents.executeJavaScript(`document.querySelector('#refresh').click()`);await pause();checks.refresh=refreshRequests===before+1;
    if(inFlight)await inFlight;await pause();ui=await inspect();const refreshedWindows=state.data?.buckets.flatMap(bucket=>[bucket.primary,bucket.secondary].filter(Boolean))||[];
    checks.refreshed=successfulReads>readsBefore&&state.data?.status==='ready'&&!state.error&&!state.refreshing&&refreshedWindows.length>0&&refreshedWindows.every((value,index)=>ui.numbers[index]===new Intl.NumberFormat('ja-JP',{maximumFractionDigits:1}).format(value.remainingPercent));
  }catch(error){failure=String(error?.message||'Verification failed').slice(0,300);}
  finally{if(state.pinned!==originalPin)togglePin();if(originalVisible){win.show();win.focus();}else win.hide();}
  publish();await pause();const ui=await inspect();
  await writeFile(path.join(directory,'app.png'),(await win.capturePage()).toPNG());
  await writeFile(path.join(directory,'live-verification.json'),JSON.stringify({observedAt:new Date().toISOString(),visible:win.isVisible(),windowId:win.webContents.id,url:win.webContents.getURL(),bounds:win.getBounds(),state,ui,checks,successfulReads,uiChecksPass:!failure&&Object.keys(checks).length>=14&&Object.values(checks).every(Boolean),failure},null,2));
  if(process.env.CODEX_USAGE_EXIT_AFTER_VERIFY==='1')app.quit();
}
if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',()=>{if(win){win.show();win.focus();}});
  app.whenReady().then(()=>{
    const config=getConfig();win=createUsageWindow(config);state.pinned=win.isAlwaysOnTop();
    tray=new Tray(trayImage());tray.setToolTip('Codex 残量');rebuildTray();
    tray.on('click',()=>win.isVisible()?win.hide():win.show());
    ipcMain.on('usage:ready',event=>{if(allowed(event))publish();});
    ipcMain.on('usage:refresh',event=>{if(allowed(event)){refreshRequests++;void refresh();}});
    ipcMain.on('usage:pin',event=>{if(allowed(event))togglePin();});
    ipcMain.on('usage:hide',event=>{if(allowed(event))win.hide();});
    win.on('close',event=>{if(!quitting){event.preventDefault();win.hide();}});
    win.webContents.once('did-finish-load',()=>{publish();void refresh();});
    globalShortcut.register('CommandOrControl+Shift+U',()=>win.isVisible()?win.hide():win.show());
    timer=setInterval(()=>void refresh(),300000);
  });
  app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;clearInterval(timer);globalShortcut.unregisterAll();controller.abort();Promise.resolve(inFlight).catch(()=>{}).finally(()=>app.quit());});
  app.on('window-all-closed',()=>{});
}
