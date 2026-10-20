const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('codexUsage',{
  onState(handler){ipcRenderer.on('usage:state',(_event,value)=>handler(value));},
  ready(){ipcRenderer.send('usage:ready');},
  refresh(){ipcRenderer.send('usage:refresh');},
  pin(){ipcRenderer.send('usage:pin');},
  hide(){ipcRenderer.send('usage:hide');}
});
