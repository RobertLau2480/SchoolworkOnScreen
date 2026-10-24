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
  fontDataUrls: (urls: string[]) => ipcRenderer.invoke('fonts:data-urls', urls),
  setNativeTheme: (theme: string) => ipcRenderer.invoke('theme:set', theme),
  saveHistory: (payload: { date: string; html: string; enabled: boolean }) => ipcRenderer.invoke('history:save', payload),
});
