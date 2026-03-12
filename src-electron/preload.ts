import { contextBridge, ipcRenderer } from 'electron';

console.log('[PRELOAD] Preload script is initializing...');

contextBridge.exposeInMainWorld('electron', {
  invoke: (channel: string, ...args: any[]) => {
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: string, func: (...args: any[]) => void) =>
    ipcRenderer.on(channel, (_event, ...args) => func(...args)),
  off: (channel: string, func: (...args: any[]) => void) =>
    ipcRenderer.removeListener(channel, func),
  send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
});
