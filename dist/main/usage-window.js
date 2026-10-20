import {BrowserWindow,screen} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url));
export function createUsageWindow(config){
  const area=screen.getPrimaryDisplay().workArea;
  const win=new BrowserWindow({width:460,height:540,minWidth:420,minHeight:480,frame:false,backgroundColor:'#f4f6f9',resizable:true,title:'Codex 残量',alwaysOnTop:config.ui.alwaysOnTop!==false,show:false,hasShadow:true,x:area.x+Math.max(0,area.width-484),y:area.y+64,webPreferences:{preload:path.join(directory,'usage-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  win.loadFile(path.join(directory,'..','renderer','usage.html'));
  win.once('ready-to-show',()=>win.show());
  return win;
}
