import {BrowserWindow,screen} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {USAGE_APP_TITLE} from '../monitor/account-usage.js';
const directory=path.dirname(fileURLToPath(import.meta.url));
export function createUsageWindow(config){
  const area=screen.getPrimaryDisplay().workArea;
  const width=Math.min(520,area.width);
  const height=Math.min(560,area.height);
  const win=new BrowserWindow({width,height,minWidth:Math.min(420,width),minHeight:Math.min(480,height),frame:false,backgroundColor:'#f4f6f9',resizable:true,title:USAGE_APP_TITLE,alwaysOnTop:config.ui.alwaysOnTop!==false,show:false,hasShadow:true,x:area.x+Math.max(0,area.width-width-24),y:area.y+Math.min(64,area.height-height),webPreferences:{preload:path.join(directory,'usage-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  win.loadFile(path.join(directory,'..','renderer','usage.html'));
  win.once('ready-to-show',()=>win.show());
  return win;
}
