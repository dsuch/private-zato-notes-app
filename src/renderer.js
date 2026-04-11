const { Editor } = require('@tiptap/core');
const StarterKit = require('@tiptap/starter-kit').default || require('@tiptap/starter-kit');
const CodeBlockLowlight = require('@tiptap/extension-code-block-lowlight').CodeBlockLowlight || require('@tiptap/extension-code-block-lowlight').default || require('@tiptap/extension-code-block-lowlight');
const Placeholder = require('@tiptap/extension-placeholder').default || require('@tiptap/extension-placeholder');
const TaskList = require('@tiptap/extension-task-list').default || require('@tiptap/extension-task-list');
const TaskItem = require('@tiptap/extension-task-item').default || require('@tiptap/extension-task-item');
const Image = require('@tiptap/extension-image').default || require('@tiptap/extension-image');
const TextAlign = require('@tiptap/extension-text-align').default || require('@tiptap/extension-text-align');
const { Table, TableRow, TableCell, TableHeader } = require('@tiptap/extension-table');
const { all, createLowlight } = require('lowlight');

const lowlight = createLowlight(all);

let editor = null;
let currentFile = null;
let autoSaveTimer = null;
let untitledCounter = 0;
let editorFontSize = 14;
let sidebarWidth = 260;
let settingsSaveTimer = null;
let isLoadingNote = false;

const AUTO_SAVE_DELAY = 3000;
const SETTINGS_SAVE_DELAY = 500;

function log(...args) {
  console.log('[renderer]', new Date().toISOString(), ...args);
}

function logError(...args) {
  console.error('[renderer]', new Date().toISOString(), ...args);
}

function showErrorDialog(err) {
  const text = typeof err === 'string' ? err : (err.stack || err.message || String(err));
  logError('Showing error dialog:', text);
  const dlg = document.getElementById('error-dialog');
  const textarea = document.getElementById('error-dialog-text');
  textarea.value = text;
  dlg.classList.remove('hidden');
}

function hideErrorDialog() {
  document.getElementById('error-dialog').classList.add('hidden');
}

function setupDialogDismiss() {
  const dlg = document.getElementById('error-dialog');
  const content = dlg.querySelector('.error-dialog-content');

  dlg.addEventListener('click', (e) => {
    if (!content.contains(e.target)) {
      hideErrorDialog();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!dlg.classList.contains('hidden')) {
        hideErrorDialog();
        e.preventDefault();
        return;
      }
      const menu = document.getElementById('undo-close-menu');
      if (!menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
        e.preventDefault();
      }
    }
  });
}

function scheduleSettingsSave() {
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(async () => {
    try {
      await window.api.saveSettings({ sidebarWidth, editorFontSize });
      log('Settings saved: sidebarWidth=', sidebarWidth, 'editorFontSize=', editorFontSize);
    } catch (e) {
      logError('Failed to save settings:', e);
    }
  }, SETTINGS_SAVE_DELAY);
}

function initEditor() {
  log('Initializing editor');
  try {
    editor = new Editor({
      element: document.getElementById('editor'),
      extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'plaintext',
      }),
      Placeholder.configure({
        placeholder: ({ editor }) => {
          if (currentFile) return '';
          return 'Start writing...';
        },
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Image,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      ],
    content: '',
    autofocus: true,
    onUpdate: () => {
      if (isLoadingNote) return;
      log('Editor content updated');
      scheduleAutoSave();
      updateCurrentPreview();
    },
    onCreate: () => {
      log('Editor created successfully');
    },
    });

    setupEditorFontZoom();
    log('Editor initialized');
  } catch (e) {
    logError('Failed to initialize editor:', e);
    showErrorDialog(e);
  }
}

function setupEditorFontZoom() {
  const editorContainer = document.getElementById('editor-container');
  editorContainer.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaY < 0) {
        editorFontSize = Math.min(40, editorFontSize + 1);
      } else {
        editorFontSize = Math.max(8, editorFontSize - 1);
      }
      document.getElementById('editor').style.fontSize = editorFontSize + 'px';
      log('Editor font size changed to', editorFontSize);
      scheduleSettingsSave();
    }
  }, { passive: false });
}

function setupSidebarResizer() {
  const resizer = document.getElementById('sidebar-resizer');
  const sidebar = document.getElementById('sidebar');
  let isResizing = false;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    log('Sidebar resize started');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = Math.max(150, Math.min(600, e.clientX));
    sidebar.style.width = newWidth + 'px';
    sidebarWidth = newWidth;
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    log('Sidebar resize ended, width:', sidebarWidth);
    scheduleSettingsSave();
  });
}

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveCurrentNote();
  }, AUTO_SAVE_DELAY);
}

async function saveCurrentNote() {
  if (!currentFile || !editor) return;
  try {
    const content = editor.getHTML();
    await window.api.saveNote(currentFile.path, content);
    log('Saved note:', currentFile.name, '(', content.length, 'chars)');
    setStatus('Saved');
  } catch (e) {
    logError('Failed to save note:', e);
    showErrorDialog(e);
  }
}

function setStatus(text) {
  log('Status:', text);
  document.getElementById('status-text').textContent = text;
}

let cachedNotesList = [];

async function refreshNotesList() {
  log('Refreshing notes list');
  try {
    const notes = await window.api.listNotes();
    const list = document.getElementById('notes-list');

    log('Got', notes.length, 'notes');

    const notesChanged = notes.length !== cachedNotesList.length ||
      notes.some((n, i) => !cachedNotesList[i] || n.path !== cachedNotesList[i].path);

    if (notesChanged) {
      cachedNotesList = notes;
      list.innerHTML = '';

      for (const note of notes) {
        const item = document.createElement('div');
        item.className = 'note-item';
        item.dataset.path = note.path;
        item.addEventListener('click', () => openNote(note));

        const title = document.createElement('div');
        title.className = 'note-item-title';
        title.textContent = note.name;

        const preview = document.createElement('div');
        preview.className = 'note-item-preview';

        try {
          const content = await window.api.readNote(note.path);
          const firstLine = getFirstLineFromHtml(content);
          preview.textContent = firstLine.substring(0, 60);
        } catch {
          preview.textContent = '';
        }

        item.appendChild(title);
        item.appendChild(preview);
        list.appendChild(item);
      }
    }

    const items = list.querySelectorAll('.note-item');
    items.forEach(item => {
      if (currentFile && item.dataset.path === currentFile.path) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  } catch (e) {
    logError('Failed to refresh notes list:', e);
    showErrorDialog(e);
  }
}

function getFirstLineFromHtml(html) {
  if (!html) return '';
  const withNewlines = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  const decoded = withNewlines
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  const firstLine = decoded.split('\n')[0];
  return firstLine;
}

function updateCurrentPreview() {
  if (!currentFile || !editor) return;
  const html = editor.getHTML();
  const firstLine = getFirstLineFromHtml(html);
  const items = document.getElementById('notes-list').querySelectorAll('.note-item');
  items.forEach(item => {
    if (item.dataset.path === currentFile.path) {
      const preview = item.querySelector('.note-item-preview');
      if (preview) preview.textContent = firstLine.substring(0, 60);
    }
  });
}

async function openNote(note) {
  log('Opening note:', note.name, note.path);
  try {
    if (currentFile && editor && currentFile.path !== note.path) {
      const prevFile = currentFile;
      const prevContent = editor.getHTML();
      window.api.saveNote(prevFile.path, prevContent);
    }

    currentFile = note;

    const items = document.getElementById('notes-list').querySelectorAll('.note-item');
    items.forEach(item => {
      if (item.dataset.path === note.path) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    const content = await window.api.readNote(note.path);
    isLoadingNote = true;
    editor.commands.setContent(content || '');
    isLoadingNote = false;
    setStatus(note.name);
    log('Note opened:', note.name);
  } catch (e) {
    isLoadingNote = false;
    logError('Failed to open note:', e);
    showErrorDialog(e);
  }
}

async function createNewNote() {
  log('Creating new note');
  try {
    if (currentFile && editor) {
      await saveCurrentNote();
    }

    const notes = await window.api.listNotes();
    const existingUntitled = notes
      .map(n => n.name)
      .filter(n => n.startsWith('Untitled-'))
      .map(n => parseInt(n.replace('Untitled-', '').replace(/\.[^.]+$/, ''), 10))
      .filter(n => !isNaN(n));
    untitledCounter = existingUntitled.length > 0 ? Math.max(...existingUntitled) + 1 : 1;

    const fileName = `Untitled-${untitledCounter}.md`;
    log('New note filename:', fileName);
    const filePath = await window.api.createNote(fileName);
    log('New note created at:', filePath);
    const note = { name: fileName, path: filePath };
    currentFile = note;
    isLoadingNote = true;
    editor.commands.setContent('');
    isLoadingNote = false;
    setStatus(fileName);
    await refreshNotesList();
    log('New note ready:', fileName);
  } catch (e) {
    isLoadingNote = false;
    logError('Failed to create new note:', e);
    showErrorDialog(e);
  }
}

const DEFAULT_PROMPT_CONTENT = `be super terse, do not babble, and keep your mouth shut, do not ask me any questions, do not offer advice i did not ask about, just follow my instructions and questions, nothing else is expected from you
and never use ALL CAPS with me, and never use "This Silly Naming Convention" in headers, always this "Normal naming convention" in headers
and never use "\u2014" instead always use a normal "-" dash (minus sign)
and never use "&", always use "and"
and never use semicolons, always use a comma
and never give me any summaries, or executive summaries, or reality checks or any other crap like that
i repeat, do not ask my any questions
and make sure all the links are always inline, and always clickable
and i repeat, keep your mouth shut, do not ask me any questions, do not offer any advice unasked, just keep your mouth shut
and never give me multiple options, i only ever want a single answer, not any or's
and never use the "sidecar" stupid term, never fucking use it
and never tell me "You are right to push back." i can't stand it
-------------
`;

async function createNewPromptNote() {
  log('Creating new prompt note');
  try {
    if (currentFile && editor) {
      await saveCurrentNote();
    }

    let promptContent = await window.api.getDefaultPrompt();
    if (!promptContent) {
      promptContent = DEFAULT_PROMPT_CONTENT;
    }

    const promptHtml = promptContent
      .split('\n')
      .map(line => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '<br>'}</p>`)
      .join('');

    const notes = await window.api.listNotes();
    const existingUntitled = notes
      .map(n => n.name)
      .filter(n => n.startsWith('Untitled-'))
      .map(n => parseInt(n.replace('Untitled-', '').replace(/\.[^.]+$/, ''), 10))
      .filter(n => !isNaN(n));
    untitledCounter = existingUntitled.length > 0 ? Math.max(...existingUntitled) + 1 : 1;

    const fileName = `Untitled-${untitledCounter}.md`;
    log('New prompt note filename:', fileName);
    const filePath = await window.api.createNote(fileName);
    await window.api.saveNote(filePath, promptHtml);
    log('New prompt note created at:', filePath);
    const note = { name: fileName, path: filePath };
    currentFile = note;
    isLoadingNote = true;
    editor.commands.setContent(promptHtml);
    isLoadingNote = false;
    setStatus(fileName);
    await refreshNotesList();
    log('New prompt note ready:', fileName);
  } catch (e) {
    isLoadingNote = false;
    logError('Failed to create new prompt note:', e);
    showErrorDialog(e);
  }
}

async function openFileFromDisk() {
  log('Opening file from disk');
  try {
    const result = await window.api.openFileDialog();
    if (!result) {
      log('File dialog canceled');
      return;
    }

    log('File selected:', result.name, result.path);

    if (currentFile && editor) {
      await saveCurrentNote();
    }

    currentFile = { name: result.name, path: result.path };
    editor.commands.setContent(result.content || '');
    setStatus(result.name);
    refreshNotesList();
    log('File opened from disk:', result.name);
  } catch (e) {
    logError('Failed to open file from disk:', e);
    showErrorDialog(e);
  }
}

async function closeCurrentNote() {
  log('Closing current note');
  try {
    if (!currentFile) {
      log('No note to close');
      return;
    }

    await saveCurrentNote();

    await window.api.addRecentlyClosed({
      name: currentFile.name,
      path: currentFile.path,
    });
    log('Added to recently closed:', currentFile.name);

    currentFile = null;
    editor.commands.setContent('');
    setStatus('Ready');
    await refreshNotesList();
    log('Note closed');
  } catch (e) {
    logError('Failed to close note:', e);
    showErrorDialog(e);
  }
}

async function showUndoCloseMenu() {
  log('Showing undo close menu');
  try {
    const items = await window.api.getRecentlyClosed();
    log('Recently closed items:', items.length);
    const menu = document.getElementById('undo-close-menu');

    if (items.length === 0) {
      menu.innerHTML = '<div class="dropdown-item" style="color: var(--text-secondary);">No recently closed files</div>';
    } else {
      menu.innerHTML = '';
      for (const item of items) {
        const el = document.createElement('div');
        el.className = 'dropdown-item';

        const nameEl = document.createElement('div');
        nameEl.className = 'dropdown-item-name';
        nameEl.textContent = item.name;

        const timeEl = document.createElement('div');
        timeEl.className = 'dropdown-item-time';
        timeEl.textContent = formatTimeAgo(item.closedAt);

        el.appendChild(nameEl);
        el.appendChild(timeEl);

        el.addEventListener('click', async () => {
          menu.classList.add('hidden');
          log('Reopening closed file:', item.name, item.path);
          try {
            const content = await window.api.readNote(item.path);
            currentFile = { name: item.name, path: item.path };
            editor.commands.setContent(content || '');
            setStatus(item.name);
            refreshNotesList();
            log('Reopened:', item.name);
          } catch (e) {
            logError('Failed to reopen file:', e);
            showErrorDialog(e);
          }
        });

        menu.appendChild(el);
      }
    }

    const btn = document.getElementById('btn-undo-close');
    const rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';
    menu.classList.remove('hidden');

    const closeMenu = (e) => {
      if (!menu.contains(e.target) && e.target !== btn) {
        menu.classList.add('hidden');
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  } catch (e) {
    logError('Failed to show undo close menu:', e);
    showErrorDialog(e);
  }
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.floor(minutes / 60);
  return hours + 'h ago';
}

async function pushToRepo() {
  log('Push to repo started');
  const btn = document.getElementById('btn-push');
  try {
    btn.classList.add('pushing');
    btn.textContent = 'Pushing...';
    setStatus('Pushing to repo...');

    if (currentFile && editor) {
      await saveCurrentNote();
    }

    const result = await window.api.pushToRepo();
    btn.classList.remove('pushing');
    btn.textContent = 'Push';

    if (result.success) {
      log('Push succeeded:', result.message);
      setStatus(result.message);
    } else {
      const errMsg = result.message || '(no error message returned)';
      logError('Push failed:', errMsg);
      setStatus('Push failed');
      showErrorDialog('Push failed:\n\n' + errMsg);
    }
  } catch (e) {
    btn.classList.remove('pushing');
    btn.textContent = 'Push';
    logError('Push error:', e);
    showErrorDialog(e);
  }
}

async function loadAppSettings() {
  log('Loading app settings');
  try {
    const s = await window.api.loadSettings();
    log('Settings loaded:', s);
    if (s.sidebarWidth) {
      sidebarWidth = s.sidebarWidth;
      document.getElementById('sidebar').style.width = sidebarWidth + 'px';
    }
    if (s.editorFontSize) {
      editorFontSize = s.editorFontSize;
      document.getElementById('editor').style.fontSize = editorFontSize + 'px';
    }
  } catch (e) {
    logError('Failed to load settings:', e);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  log('DOMContentLoaded fired');

  document.getElementById('error-dialog-close').addEventListener('click', hideErrorDialog);
  document.getElementById('error-dialog-copy').addEventListener('click', () => {
    const textarea = document.getElementById('error-dialog-text');
    textarea.select();
    document.execCommand('copy');
    log('Error text copied to clipboard');
  });

  await loadAppSettings();
  initEditor();
  setupSidebarResizer();
  setupDialogDismiss();

  document.getElementById('btn-new-prompt').addEventListener('click', () => {
    log('New prompt button clicked');
    createNewPromptNote();
  });
  document.getElementById('btn-new').addEventListener('click', () => {
    log('New button clicked');
    createNewNote();
  });
  document.getElementById('btn-open').addEventListener('click', () => {
    log('Open button clicked');
    openFileFromDisk();
  });
  document.getElementById('btn-close').addEventListener('click', () => {
    log('Close button clicked');
    closeCurrentNote();
  });
  document.getElementById('btn-undo-close').addEventListener('click', () => {
    log('Undo close button clicked');
    showUndoCloseMenu();
  });
  document.getElementById('btn-push').addEventListener('click', () => {
    log('Push button clicked');
    pushToRepo();
  });

  log('Button handlers attached');

  await refreshNotesList();

  const notes = await window.api.listNotes();
  if (notes.length > 0) {
    log('Auto-opening first note:', notes[0].name);
    await openNote(notes[0]);
  }

  log('App initialization complete');
});
