const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onCloseNote: (callback) => ipcRenderer.on('close-current-note', callback),
  listNotes: () => ipcRenderer.invoke('list-notes'),
  readNote: (filePath) => ipcRenderer.invoke('read-note', filePath),
  saveNote: (filePath, content) => ipcRenderer.invoke('save-note', filePath, content),
  createNote: (fileName) => ipcRenderer.invoke('create-note', fileName),
  deleteNote: (filePath) => ipcRenderer.invoke('delete-note', filePath),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  pushToRepo: () => ipcRenderer.invoke('push-to-repo'),
  getRecentlyClosed: () => ipcRenderer.invoke('get-recently-closed'),
  addRecentlyClosed: (entry) => ipcRenderer.invoke('add-recently-closed', entry),
  getNotesDir: () => ipcRenderer.invoke('get-notes-dir'),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  getDefaultPrompt: () => ipcRenderer.invoke('get-default-prompt'),
  getOpenExternal: () => ipcRenderer.invoke('get-open-external'),
  saveOpenExternal: (list) => ipcRenderer.invoke('save-open-external', list),
  quitApp: () => ipcRenderer.invoke('quit-app'),
});
