const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const NOTES_DIR = path.join(__dirname, '..', 'notes');
const APP_DATA_DIR = path.join(__dirname, '..', 'app-data');
const RECENTLY_CLOSED_FILE = path.join(APP_DATA_DIR, 'recently-closed.json');
const SETTINGS_FILE = path.join(__dirname, '..', 'settings.json');

if (!fs.existsSync(NOTES_DIR)) fs.mkdirSync(NOTES_DIR, { recursive: true });
if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  zoomLevel: 0,
  sidebarWidth: 260,
  editorFontSize: 14,
  windowWidth: 1200,
  windowHeight: 800,
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) };
    }
  } catch (e) {
    console.error('[main] Failed to load settings:', e);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    console.log('[main] Settings saved:', settings);
  } catch (e) {
    console.error('[main] Failed to save settings:', e);
  }
}

let mainWindow;
let settings = loadSettings();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: settings.windowWidth,
    height: settings.windowHeight,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Notes App',
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.setZoomLevel(settings.zoomLevel);
    console.log('[main] Window loaded, zoom level set to', settings.zoomLevel);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.key === 'F12') {
      console.log('[main] Toggling devtools');
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
      return;
    }
    if (input.key === 'F12') {
      console.log('[main] Toggling devtools');
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
      return;
    }
    if (input.control && (input.key === '=' || input.key === '+')) {
      const newZoom = mainWindow.webContents.getZoomLevel() + 0.5;
      mainWindow.webContents.setZoomLevel(newZoom);
      settings.zoomLevel = newZoom;
      saveSettings(settings);
      console.log('[main] Zoom in, level:', newZoom);
      event.preventDefault();
    } else if (input.control && input.key === '-') {
      const newZoom = mainWindow.webContents.getZoomLevel() - 0.5;
      mainWindow.webContents.setZoomLevel(newZoom);
      settings.zoomLevel = newZoom;
      saveSettings(settings);
      console.log('[main] Zoom out, level:', newZoom);
      event.preventDefault();
    } else if (input.control && input.key === '0') {
      mainWindow.webContents.setZoomLevel(0);
      settings.zoomLevel = 0;
      saveSettings(settings);
      console.log('[main] Zoom reset');
      event.preventDefault();
    }
  });

  mainWindow.on('resize', () => {
    const [w, h] = mainWindow.getSize();
    settings.windowWidth = w;
    settings.windowHeight = h;
    saveSettings(settings);
  });
}

app.whenReady().then(() => {
  console.log('[main] App ready, creating window');
  createWindow();
});

app.on('window-all-closed', () => {
  console.log('[main] All windows closed, quitting');
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('list-notes', async () => {
  console.log('[main] list-notes called');
  try {
    const files = fs.readdirSync(NOTES_DIR);
    const result = files
      .filter(f => {
        try { return fs.statSync(path.join(NOTES_DIR, f)).isFile(); } catch { return false; }
      })
      .filter(f => f !== '.gitkeep')
      .map(f => ({
        name: f,
        path: path.join(NOTES_DIR, f),
        mtime: fs.statSync(path.join(NOTES_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    console.log('[main] list-notes returning', result.length, 'files');
    return result;
  } catch (e) {
    console.error('[main] list-notes error:', e);
    throw e;
  }
});

ipcMain.handle('read-note', async (event, filePath) => {
  console.log('[main] read-note:', filePath);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    console.error('[main] read-note error:', e);
    throw e;
  }
});

ipcMain.handle('save-note', async (event, filePath, content) => {
  console.log('[main] save-note:', filePath, '(', content.length, 'chars)');
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch (e) {
    console.error('[main] save-note error:', e);
    throw e;
  }
});

ipcMain.handle('create-note', async (event, fileName) => {
  console.log('[main] create-note:', fileName);
  try {
    const filePath = path.join(NOTES_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf-8');
    }
    console.log('[main] create-note created:', filePath);
    return filePath;
  } catch (e) {
    console.error('[main] create-note error:', e);
    throw e;
  }
});

ipcMain.handle('delete-note', async (event, filePath) => {
  console.log('[main] delete-note:', filePath);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch (e) {
    console.error('[main] delete-note error:', e);
    throw e;
  }
});

ipcMain.handle('open-file-dialog', async () => {
  console.log('[main] open-file-dialog called');
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Text', extensions: ['txt', 'md', 'py', 'js', 'java', 'rs', 'go', 'rb', 'sh', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      console.log('[main] open-file-dialog canceled');
      return null;
    }
    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    console.log('[main] open-file-dialog opened:', filePath);
    return { path: filePath, name: path.basename(filePath), content };
  } catch (e) {
    console.error('[main] open-file-dialog error:', e);
    throw e;
  }
});

ipcMain.handle('push-to-repo', async () => {
  const repoRoot = path.join(__dirname, '..');
  console.log('[main] push-to-repo called, repo root:', repoRoot);
  try {
    execSync('git add notes/', { cwd: repoRoot, stdio: 'pipe' });
    console.log('[main] git add done');
    execSync('git commit -m "Adding latest notes."', { cwd: repoRoot, stdio: 'pipe' });
    console.log('[main] git commit done');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot, stdio: 'pipe' }).toString().trim();
    console.log('[main] current branch:', branch);
    execSync(`git push origin ${branch}`, { cwd: repoRoot, stdio: 'pipe' });
    console.log('[main] git push done');
    return { success: true, message: `Pushed to ${branch}` };
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString() : err.message;
    console.error('[main] push-to-repo error:', msg);
    return { success: false, message: msg };
  }
});

ipcMain.handle('get-recently-closed', async () => {
  console.log('[main] get-recently-closed called');
  if (!fs.existsSync(RECENTLY_CLOSED_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(RECENTLY_CLOSED_FILE, 'utf-8'));
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return data.filter(item => item.closedAt > cutoff);
  } catch (e) {
    console.error('[main] get-recently-closed error:', e);
    return [];
  }
});

ipcMain.handle('add-recently-closed', async (event, entry) => {
  console.log('[main] add-recently-closed:', entry);
  try {
    let data = [];
    if (fs.existsSync(RECENTLY_CLOSED_FILE)) {
      try { data = JSON.parse(fs.readFileSync(RECENTLY_CLOSED_FILE, 'utf-8')); } catch { data = []; }
    }
    data.unshift({ ...entry, closedAt: Date.now() });
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    data = data.filter(item => item.closedAt > cutoff);
    fs.writeFileSync(RECENTLY_CLOSED_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[main] add-recently-closed error:', e);
    throw e;
  }
});

ipcMain.handle('get-notes-dir', async () => {
  return NOTES_DIR;
});

ipcMain.handle('load-settings', async () => {
  console.log('[main] load-settings called');
  return settings;
});

ipcMain.handle('save-settings', async (event, newSettings) => {
  console.log('[main] save-settings called:', newSettings);
  settings = { ...settings, ...newSettings };
  saveSettings(settings);
  return true;
});
