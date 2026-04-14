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

const { EditorView, basicSetup } = require('codemirror');
const { EditorState } = require('@codemirror/state');
const { javascript } = require('@codemirror/lang-javascript');
const { python } = require('@codemirror/lang-python');
const { java } = require('@codemirror/lang-java');
const { rust } = require('@codemirror/lang-rust');
const { html: htmlLang } = require('@codemirror/lang-html');
const { css: cssLang } = require('@codemirror/lang-css');
const { json: jsonLang } = require('@codemirror/lang-json');
const { xml } = require('@codemirror/lang-xml');
const { sql } = require('@codemirror/lang-sql');
const { markdown: markdownLang } = require('@codemirror/lang-markdown');
const { cpp } = require('@codemirror/lang-cpp');
const { php } = require('@codemirror/lang-php');
const { go } = require('@codemirror/lang-go');
const { yaml } = require('@codemirror/lang-yaml');

const lowlight = createLowlight(all);

let editor = null;
let cmView = null;
let activeEditor = 'tiptap'; // 'tiptap' or 'codemirror'
let currentFile = null;
let autoSaveTimer = null;
let untitledCounter = 0;
let editorFontSize = 14;
let sidebarWidth = 260;
let settingsSaveTimer = null;
let isLoadingNote = false;

// In-memory cache: path -> content (html for tiptap files, raw text for code files)
const noteCache = {};
// Track which files are code files
const codeFileFlags = {};
// Track which files are external (opened via Open button)
const externalFileFlags = {};
// Track which external files have been modified since last save
const externalModifiedFlags = {};
// Original content of external files (for comparing on undo)
const externalOriginalContent = {};
// In-memory recently closed list
let recentlyClosed = [];
// In-memory notes metadata list
let cachedNotesMeta = [];
const closedNotePaths = new Set();

const AUTO_SAVE_DELAY = 300;
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
      document.getElementById('codemirror-container').style.fontSize = editorFontSize + 'px';
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
  if (currentFile && externalFileFlags[currentFile.path]) {
    checkExternalModified();
    return;
  }
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveCurrentNote();
  }, AUTO_SAVE_DELAY);
}

function checkExternalModified() {
  if (!currentFile) return;
  const current = getCurrentContent();
  const original = externalOriginalContent[currentFile.path];
  const wasModified = !!externalModifiedFlags[currentFile.path];
  const isModified = current !== original;
  if (wasModified !== isModified) {
    externalModifiedFlags[currentFile.path] = isModified;
    updateModifiedIndicator();
    updateSaveButtonState();
  }
}

function updateModifiedIndicator() {
  if (!currentFile) return;
  const isModified = !!externalModifiedFlags[currentFile.path];
  const statusEl = document.getElementById('status-text');
  if (isModified) {
    statusEl.textContent = currentFile.name + ' (modified)';
  } else {
    statusEl.textContent = currentFile.name;
  }
  const items = document.getElementById('notes-list').querySelectorAll('.note-item');
  items.forEach(item => {
    if (item.dataset.path === currentFile.path) {
      const dot = item.querySelector('.note-item-modified');
      if (dot) dot.style.visibility = isModified ? 'visible' : 'hidden';
    }
  });
}

function updateSaveButtonState() {
  const btn = document.getElementById('btn-save');
  if (!btn) return;
  if (currentFile && externalFileFlags[currentFile.path] && externalModifiedFlags[currentFile.path]) {
    btn.style.display = '';
  } else {
    btn.style.display = 'none';
  }
}

async function saveExternalFile() {
  if (!currentFile || !externalFileFlags[currentFile.path]) return;
  try {
    const content = getCurrentContent();
    noteCache[currentFile.path] = content;
    externalOriginalContent[currentFile.path] = content;
    await window.api.saveNote(currentFile.path, content);
    externalModifiedFlags[currentFile.path] = false;
    updateModifiedIndicator();
    updateSaveButtonState();
    log('Saved external file:', currentFile.name);
    setStatus(currentFile.name);
  } catch (e) {
    logError('Failed to save external file:', e);
    showErrorDialog(e);
  }
}

function persistOpenExternalList() {
  const list = [];
  for (const p in externalFileFlags) {
    if (externalFileFlags[p]) {
      const name = p.split('/').pop();
      list.push({ name, path: p, code: !!codeFileFlags[p] });
    }
  }
  window.api.saveOpenExternal(list);
}

async function saveCurrentNote() {
  if (!currentFile) return;
  if (externalFileFlags[currentFile.path]) return;
  if (activeEditor === 'tiptap' && !editor) return;
  if (activeEditor === 'codemirror' && !cmView) return;
  try {
    const content = getCurrentContent();
    noteCache[currentFile.path] = content;
    await window.api.saveNote(currentFile.path, content);
    log('Saved note:', currentFile.name, '(', content.length, 'chars)');
    setStatus('Saved');
  } catch (e) {
    logError('Failed to save note:', e);
    showErrorDialog(e);
  }
}

function setStatus(text) {
  document.getElementById('status-text').textContent = text;
}

function getFirstLineFromHtml(html) {
  if (!html) return '\u00A0';
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
  if (firstLine === '' || firstLine.trim() === '') return '\u00A0';
  return firstLine;
}

function detectContentTypes(html) {
  if (!html) return [];
  const types = new Set();

  // Extract text with newlines preserved between blocks
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Check for explicit language code blocks
  const codeBlocks = html.match(/language-(\w+)/gi);
  if (codeBlocks) {
    for (const block of codeBlocks) {
      const m = block.match(/language-(\w+)/i);
      if (m) types.add(m[1]);
    }
  }

  if (/^#{1,6}\s+\w|^\*\*\w|\[.+\]\(.+\)|^```/m.test(text)) types.add('md');
  if (/\bdef\s+\w+\s*\(|\bfrom\s+\w+\s+import\b|\bclass\s+\w+\s*.*:/.test(text)) types.add('py');
  if (/\bfunction\s+\w+|\bconst\s+\w+\s*=|\blet\s+\w+\s*=|\brequire\s*\(|\bexport\s+(default\s+)?/.test(text)) types.add('js');
  if (/\bpublic\s+(static\s+)?(class|void|int|String)\b|\bprivate\s+(static\s+)?\w+|\bSystem\.out|\bimport\s+java\./.test(text)) types.add('java');
  if (/\bfn\s+\w+\s*\(|\blet\s+mut\s|\bimpl\s+\w+|\buse\s+\w+::/.test(text)) types.add('rs');
  if (/\bfunc\s+\w+\s*\(|\bpackage\s+\w+|\bfmt\.\w+|\bgo\s+func/.test(text)) types.add('go');
  if (/<html|<div|<span|<body|<head|<h[1-6]>|<table|<form|<input|<button/.test(text)) types.add('html');
  if (/[\w.-]+\s*\{[^}]*:[^}]+;[^}]*\}|@media\s|@import\s/.test(text)) types.add('css');
  if (/"\w+"\s*:\s*[{\["0-9tfn]/.test(text)) types.add('json');
  if (/^(---\s*$|[\w][\w-]*:\s*(\[|{|["']|\d+|true|false|null)\s*$)/m.test(text)) types.add('yaml');
  if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i.test(text)) types.add('sql');
  if (/#!\/bin\/(bash|sh)|\bif\s+\[|\becho\s+["$]|\bfi\b|\bdone\b/.test(text)) types.add('sh');
  if (/<\?xml|\bxmlns[:=]/.test(text)) types.add('xml');
  if (/^\[[\w.-]+\]\s*$/m.test(text)) types.add('toml');
  if (/\busing\s+System|\bnamespace\s+\w+|\bpublic\s+async\s+Task/.test(text)) types.add('cs');
  if (/\bdefmodule\s+\w+|\bdefp?\s+\w+.*do\b/.test(text)) types.add('ex');
  if (/\brequire\s*\(\s*['"]|\bmodule\.exports\s*=/.test(text)) types.add('js');
  if (/\bimport\s+\w+\s+from\s+['"]|\bexport\s+(interface|type)\s/.test(text)) types.add('ts');

  return Array.from(types).sort();
}

function updateCurrentPreview() {
  if (!currentFile) return;
  const content = getCurrentContent();
  noteCache[currentFile.path] = content;
  const isCode = codeFileFlags[currentFile.path];
  const firstLine = isCode ? getFirstLineFromPlainText(content) : getFirstLineFromHtml(content);
  const types = isCode ? detectContentTypes(content) : detectContentTypes(content);
  const items = document.getElementById('notes-list').querySelectorAll('.note-item');
  items.forEach(item => {
    if (item.dataset.path === currentFile.path) {
      const preview = item.querySelector('.note-item-preview');
      if (preview) preview.textContent = firstLine.substring(0, 60);
      const tags = item.querySelector('.note-item-tags');
      if (tags) tags.textContent = types.join(' ');
    }
  });
}

function getFirstLineFromPlainText(text) {
  if (!text) return '\u00A0';
  const firstLine = text.split('\n')[0];
  if (firstLine === '' || firstLine.trim() === '') return '\u00A0';
  return firstLine;
}

function stripHtmlToPlainText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function isHtmlContent(content) {
  return content && /^\s*</.test(content);
}

async function loadAllNotesIntoCache() {
  log('Loading all notes into RAM');
  const notes = await window.api.listNotes();
  cachedNotesMeta = notes;
  for (const note of notes) {
    try {
      let raw = await window.api.readNote(note.path);
      const isCode = isCodeFile(note.name);
      codeFileFlags[note.path] = isCode;
      if (isCode && isHtmlContent(raw)) {
        raw = stripHtmlToPlainText(raw);
      }
      noteCache[note.path] = raw;
    } catch {
      noteCache[note.path] = '';
      codeFileFlags[note.path] = false;
    }
  }
  log('Loaded', Object.keys(noteCache).length, 'notes into cache');
  return notes;
}

function buildNoteItem(note) {
  const item = document.createElement('div');
  item.className = 'note-item';
  item.dataset.path = note.path;
  item.addEventListener('click', () => openNote(note));

  const titleRow = document.createElement('div');
  titleRow.className = 'note-item-title-row';

  const isExternal = !!externalFileFlags[note.path];
  const isModified = isExternal && !!externalModifiedFlags[note.path];

  if (isExternal) {
    const dot = document.createElement('span');
    dot.className = 'note-item-modified';
    dot.textContent = '\u25CF';
    dot.style.visibility = isModified ? 'visible' : 'hidden';
    titleRow.appendChild(dot);
  }

  const title = document.createElement('div');
  title.className = 'note-item-title';
  title.textContent = note.name;

  const tags = document.createElement('div');
  tags.className = 'note-item-tags';
  const content = noteCache[note.path] || '';
  tags.textContent = detectContentTypes(content).join(' ');

  titleRow.appendChild(title);
  titleRow.appendChild(tags);

  const preview = document.createElement('div');
  preview.className = 'note-item-preview';
  const isCode = codeFileFlags[note.path];
  const firstLine = isCode ? getFirstLineFromPlainText(content) : getFirstLineFromHtml(content);
  preview.textContent = firstLine.substring(0, 60);

  item.appendChild(titleRow);
  item.appendChild(preview);
  return item;
}

function getOpenExternalFiles() {
  const externals = [];
  for (const path in externalFileFlags) {
    if (externalFileFlags[path] && noteCache[path] !== undefined) {
      const name = path.split('/').pop();
      externals.push({ name, path });
    }
  }
  return externals;
}

function buildNotesList(notes) {
  cachedNotesMeta = notes;
  const list = document.getElementById('notes-list');
  list.innerHTML = '';

  const externals = getOpenExternalFiles();
  for (const ext of externals) {
    list.appendChild(buildNoteItem(ext));
  }

  for (const note of notes) {
    if (externalFileFlags[note.path]) continue;
    if (closedNotePaths.has(note.path)) continue;
    list.appendChild(buildNoteItem(note));
  }

  updateActiveState();
}

function updateActiveState() {
  const items = document.getElementById('notes-list').querySelectorAll('.note-item');
  items.forEach(item => {
    if (currentFile && item.dataset.path === currentFile.path) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

function openNote(note) {
  log('Opening note:', note.name);
  try {
    if (currentFile && currentFile.path !== note.path) {
      noteCache[currentFile.path] = getCurrentContent();
      if (!externalFileFlags[currentFile.path]) {
        window.api.saveNote(currentFile.path, noteCache[currentFile.path]);
      }
    }

    currentFile = note;
    updateActiveState();

    const content = noteCache[note.path] || '';
    const isCode = codeFileFlags[note.path];

    if (isCode) {
      showCodeMirror(content, note.name);
    } else {
      showTiptap(content);
    }

    setStatus(note.name);
    updateModifiedIndicator();
    updateSaveButtonState();
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
    if (currentFile) {
      noteCache[currentFile.path] = getCurrentContent();
      window.api.saveNote(currentFile.path, noteCache[currentFile.path]);
    }

    const notes = await window.api.listNotes();
    const existingUntitled = notes
      .map(n => n.name)
      .filter(n => n.startsWith('Untitled-'))
      .map(n => parseInt(n.replace('Untitled-', '').replace(/\.[^.]+$/, ''), 10))
      .filter(n => !isNaN(n));
    untitledCounter = existingUntitled.length > 0 ? Math.max(...existingUntitled) + 1 : 1;

    const fileName = `Untitled-${untitledCounter}.md`;
    const filePath = await window.api.createNote(fileName);
    noteCache[filePath] = '';
    codeFileFlags[filePath] = false;
    const note = { name: fileName, path: filePath };
    currentFile = note;
    showTiptap('');
    setStatus(fileName);

    const updatedNotes = await window.api.listNotes();
    buildNotesList(updatedNotes);
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
    if (currentFile) {
      noteCache[currentFile.path] = getCurrentContent();
      window.api.saveNote(currentFile.path, noteCache[currentFile.path]);
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
    const filePath = await window.api.createNote(fileName);
    noteCache[filePath] = promptHtml;
    codeFileFlags[filePath] = false;
    await window.api.saveNote(filePath, promptHtml);
    const note = { name: fileName, path: filePath };
    currentFile = note;
    showTiptap(promptHtml);
    setStatus(fileName);

    const updatedNotes = await window.api.listNotes();
    buildNotesList(updatedNotes);
    log('New prompt note ready:', fileName);
  } catch (e) {
    isLoadingNote = false;
    logError('Failed to create new prompt note:', e);
    showErrorDialog(e);
  }
}

const CODE_EXTENSIONS = new Set([
  'py', 'js', 'ts', 'jsx', 'tsx', 'java', 'rs', 'go', 'rb', 'sh', 'bash',
  'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'scala', 'pl', 'pm',
  'lua', 'r', 'php', 'ex', 'exs', 'erl', 'hs', 'ml', 'clj', 'lisp',
  'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'css', 'scss', 'less',
  'html', 'htm', 'vue', 'svelte', 'conf', 'ini', 'cfg', 'env',
  'dockerfile', 'makefile', 'cmake', 'gradle', 'tf', 'hcl',
]);

function getCMLanguage(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const map = {
    js: javascript, jsx: javascript, ts: () => javascript({ typescript: true }), tsx: () => javascript({ typescript: true }),
    py: python, java: java, rs: rust, go: go,
    html: htmlLang, htm: htmlLang, vue: htmlLang, svelte: htmlLang,
    css: cssLang, scss: cssLang, less: cssLang,
    json: jsonLang, xml: xml, sql: sql, yaml: yaml, yml: yaml,
    md: markdownLang, c: cpp, cpp: cpp, h: cpp, hpp: cpp,
    php: php,
  };
  const langFn = map[ext];
  if (!langFn) return [];
  const result = langFn();
  return [result];
}

function showCodeMirror(content, fileName) {
  const cmContainer = document.getElementById('codemirror-container');
  const editorEl = document.getElementById('editor');

  editorEl.style.display = 'none';
  cmContainer.classList.remove('hidden');
  cmContainer.style.display = '';

  if (cmView) {
    cmView.destroy();
    cmView = null;
  }

  const langExtensions = getCMLanguage(fileName);

  const state = EditorState.create({
    doc: content || '',
    extensions: [
      basicSetup,
      ...langExtensions,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !isLoadingNote) {
          scheduleAutoSave();
        }
      }),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
      }),
    ],
  });

  cmView = new EditorView({
    state,
    parent: cmContainer,
  });

  cmContainer.style.fontSize = editorFontSize + 'px';
  activeEditor = 'codemirror';
  log('CodeMirror shown for:', fileName);
}

function showTiptap(content) {
  const cmContainer = document.getElementById('codemirror-container');
  const editorEl = document.getElementById('editor');

  cmContainer.classList.add('hidden');
  cmContainer.style.display = 'none';
  editorEl.style.display = '';

  if (cmView) {
    cmView.destroy();
    cmView = null;
  }

  isLoadingNote = true;
  editor.commands.setContent(content || '');
  isLoadingNote = false;
  activeEditor = 'tiptap';
}

function getCurrentContent() {
  if (activeEditor === 'codemirror' && cmView) {
    return cmView.state.doc.toString();
  }
  if (editor) {
    return editor.getHTML();
  }
  return '';
}

function isCodeFile(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  return CODE_EXTENSIONS.has(ext) || fileName.toLowerCase() === 'makefile' || fileName.toLowerCase() === 'dockerfile';
}

async function openFileFromDisk() {
  log('Opening file from disk');
  try {
    const result = await window.api.openFileDialog();
    if (!result) return;

    if (currentFile) {
      noteCache[currentFile.path] = getCurrentContent();
      if (!externalFileFlags[currentFile.path]) {
        window.api.saveNote(currentFile.path, noteCache[currentFile.path]);
      }
    }

    const isCode = isCodeFile(result.name);
    codeFileFlags[result.path] = isCode;
    externalFileFlags[result.path] = true;
    externalModifiedFlags[result.path] = false;
    let content = result.content || '';
    if (isCode && isHtmlContent(content)) {
      content = stripHtmlToPlainText(content);
    }
    noteCache[result.path] = content;
    externalOriginalContent[result.path] = content;
    currentFile = { name: result.name, path: result.path };

    if (isCode) {
      showCodeMirror(content, result.name);
    } else {
      showTiptap(content);
    }

    setStatus(result.name);
    updateSaveButtonState();
    const updatedNotes = await window.api.listNotes();
    buildNotesList(updatedNotes);
    persistOpenExternalList();
    log('File opened from disk:', result.name);
  } catch (e) {
    isLoadingNote = false;
    logError('Failed to open file from disk:', e);
    showErrorDialog(e);
  }
}

let isClosing = false;

function closeCurrentNote() {
  if (isClosing) return;
  if (!currentFile) return;
  isClosing = true;
  log('Closing current note:', currentFile.name);
  try {
    noteCache[currentFile.path] = getCurrentContent();
    if (!externalFileFlags[currentFile.path]) {
      window.api.saveNote(currentFile.path, noteCache[currentFile.path]);
    }

    const wasExternal = !!externalFileFlags[currentFile.path];
    const wasCode = !!codeFileFlags[currentFile.path];
    recentlyClosed = recentlyClosed.filter(r => r.path !== currentFile.path);
    recentlyClosed.unshift({
      name: currentFile.name, path: currentFile.path, closedAt: Date.now(),
      external: wasExternal, code: wasCode,
    });
    window.api.addRecentlyClosed({ name: currentFile.name, path: currentFile.path });

    const closedPath = currentFile.path;
    if (!externalFileFlags[closedPath]) {
      closedNotePaths.add(closedPath);
      window.api.deleteNote(closedPath);
    }
    delete externalFileFlags[closedPath];
    delete externalModifiedFlags[closedPath];
    delete externalOriginalContent[closedPath];
    persistOpenExternalList();
    currentFile = null;
    showTiptap('');
    setStatus('Ready');
    updateSaveButtonState();

    const listEl = document.getElementById('notes-list');
    const closedItem = listEl.querySelector('[data-path="' + closedPath + '"]');
    if (closedItem) closedItem.remove();

    const remaining = listEl.querySelectorAll('.note-item');
    if (remaining.length > 0) {
      const nextPath = remaining[0].dataset.path;
      const cached = cachedNotesMeta.find(n => n.path === nextPath);
      if (cached) openNote(cached);
    }

    log('Note closed');
  } catch (e) {
    logError('Failed to close note:', e);
    showErrorDialog(e);
  }
  isClosing = false;
}

function getPreviewFromCache(filePath) {
  const html = noteCache[filePath] || '';
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
  const trimmed = decoded.replace(/^\s+/, '');
  const firstLine = trimmed.split('\n')[0] || '';
  return firstLine.substring(0, 60);
}

async function showUndoCloseMenu() {
  log('Showing undo close menu');
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const items = recentlyClosed.filter(r => r.closedAt > cutoff);
    const menu = document.getElementById('undo-close-menu');

    if (items.length === 0) {
      menu.innerHTML = '<div class="dropdown-item" style="color: var(--text-secondary);">No recently closed files</div>';
    } else {
      menu.innerHTML = '';
      for (const item of items) {
        const el = document.createElement('div');
        el.className = 'dropdown-item';

        const nameRow = document.createElement('div');
        nameRow.className = 'dropdown-item-name-row';

        const nameEl = document.createElement('div');
        nameEl.className = 'dropdown-item-name';
        nameEl.textContent = item.name;

        const tagsEl = document.createElement('div');
        tagsEl.className = 'dropdown-item-tags';
        tagsEl.textContent = detectContentTypes(noteCache[item.path] || '').join(' ');

        nameRow.appendChild(nameEl);
        nameRow.appendChild(tagsEl);

        const previewEl = document.createElement('div');
        previewEl.className = 'dropdown-item-time';
        previewEl.textContent = getPreviewFromCache(item.path) || formatTimeAgo(item.closedAt);

        el.appendChild(nameRow);
        el.appendChild(previewEl);

        el.addEventListener('mousedown', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          menu.classList.add('hidden');
          log('Undo close clicked:', item.name, item.path);
          try {
            recentlyClosed = recentlyClosed.filter(r => r.path !== item.path);
            closedNotePaths.delete(item.path);

            if (item.external) {
              externalFileFlags[item.path] = true;
              externalModifiedFlags[item.path] = false;
            }
            if (item.code) {
              codeFileFlags[item.path] = true;
            }

            if (noteCache[item.path] !== undefined && !item.external) {
              await window.api.saveNote(item.path, noteCache[item.path]);
            } else if (!noteCache[item.path]) {
              try {
                let raw = await window.api.readNote(item.path);
                if (codeFileFlags[item.path] && isHtmlContent(raw)) {
                  raw = stripHtmlToPlainText(raw);
                }
                noteCache[item.path] = raw;
              } catch {
                noteCache[item.path] = '';
              }
            }
            const note = { name: item.name, path: item.path };
            currentFile = note;
            if (codeFileFlags[item.path]) {
              showCodeMirror(noteCache[item.path] || '', item.name);
            } else {
              showTiptap(noteCache[item.path] || '');
            }
            setStatus(item.name);
            updateSaveButtonState();

            const updatedNotes = await window.api.listNotes();
            buildNotesList(updatedNotes);
            log('Undo close done:', item.name);
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

    if (currentFile && !externalFileFlags[currentFile.path]) {
      noteCache[currentFile.path] = getCurrentContent();
      await window.api.saveNote(currentFile.path, noteCache[currentFile.path]);
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
      document.getElementById('codemirror-container').style.fontSize = editorFontSize + 'px';
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
  });

  await loadAppSettings();
  initEditor();
  setupSidebarResizer();
  setupDialogDismiss();

  window.api.onCloseNote(() => closeCurrentNote());

  document.getElementById('btn-new').addEventListener('click', createNewNote);
  document.getElementById('btn-new-prompt').addEventListener('click', createNewPromptNote);
  document.getElementById('btn-open').addEventListener('click', openFileFromDisk);
  document.getElementById('btn-save').addEventListener('click', saveExternalFile);
  document.getElementById('btn-close').addEventListener('click', closeCurrentNote);
  document.getElementById('btn-undo-close').addEventListener('click', showUndoCloseMenu);
  document.getElementById('btn-push').addEventListener('click', pushToRepo);
  document.getElementById('btn-quit').addEventListener('click', () => window.api.quitApp());

  try {
    const persisted = await window.api.getRecentlyClosed();
    recentlyClosed = persisted || [];
    log('Loaded', recentlyClosed.length, 'recently closed from disk');
  } catch (e) {
    logError('Failed to load recently closed:', e);
  }

  const notes = await loadAllNotesIntoCache();

  try {
    const savedExternal = await window.api.getOpenExternal();
    for (const ext of savedExternal) {
      if (!externalFileFlags[ext.path]) {
        try {
          const content = await window.api.readNote(ext.path);
          const isCode = ext.code || isCodeFile(ext.name);
          externalFileFlags[ext.path] = true;
          externalModifiedFlags[ext.path] = false;
          codeFileFlags[ext.path] = isCode;
          let cleaned = content || '';
          if (isCode && isHtmlContent(cleaned)) {
            cleaned = stripHtmlToPlainText(cleaned);
          }
          noteCache[ext.path] = cleaned;
          externalOriginalContent[ext.path] = cleaned;
          log('Restored external file:', ext.name);
        } catch (e) {
          logError('Failed to restore external file:', ext.name, e);
        }
      }
    }
  } catch (e) {
    logError('Failed to load open external list:', e);
  }

  buildNotesList(notes);

  if (notes.length > 0) {
    openNote(notes[0]);
  }

  log('App initialization complete');
});
