const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
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
});
