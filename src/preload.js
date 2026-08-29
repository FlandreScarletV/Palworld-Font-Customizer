const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('palFont', {
  openFontLibrary: () => ipcRenderer.invoke('font-library:open'),
  listSystemFonts: () => ipcRenderer.invoke('font-library:list'),
  loadFont: (fontPath) => ipcRenderer.invoke('font:load', fontPath),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  selectSystemFont: (fontPath) => ipcRenderer.invoke('font-library:select', fontPath),
  getStatus: () => ipcRenderer.invoke('app:status'),
  selectGamePath: () => ipcRenderer.invoke('game:select-path'),
  applyFont: (fontPath, axisValues) => ipcRenderer.invoke('font:apply', fontPath, axisValues),
  restoreDefault: () => ipcRenderer.invoke('font:restore-default'),
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('app:progress', listener);
    return () => ipcRenderer.removeListener('app:progress', listener);
  },
  onFontSelected: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('font:selected', listener);
    return () => ipcRenderer.removeListener('font:selected', listener);
  }
});
