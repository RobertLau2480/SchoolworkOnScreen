import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('schoolwork', {
  load: () => ipcRenderer.invoke('data:load'),
  saveContent: (content: unknown) => ipcRenderer.invoke('data:save-content', content),
  saveSettings: (settings: Record<string, string>) => ipcRenderer.invoke('data:save-settings', settings),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  confirmLayout: (message: string) => ipcRenderer.invoke('dialog:confirm-layout', message),
});
