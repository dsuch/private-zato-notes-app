const assert = require('assert');
const { generateJSON, generateHTML } = require('@tiptap/html/server');
const StarterKit = require('@tiptap/starter-kit').default || require('@tiptap/starter-kit');
const { CodeBlockLowlight } = require('@tiptap/extension-code-block-lowlight');
const { all, createLowlight } = require('lowlight');

const lowlight = createLowlight(all);

const extensions = [
  StarterKit.configure({ codeBlock: false }),
  CodeBlockLowlight.configure({ lowlight }),
];

const CODE_SAMPLES = [
  {
    name: 'Python with angle brackets',
    lang: 'python',
    code: 'def foo():\n    print("<hello>")\n    x = 1 < 2\n',
  },
  {
    name: 'Rust with generics',
    lang: 'rust',
    code: 'fn main() {\n    let v: Vec<String> = Vec::new();\n    println!("{:?}", v);\n}\n',
  },
  {
    name: 'HTML source',
    lang: 'html',
    code: '<div class="test">\n  <p>Hello &amp; world</p>\n</div>\n',
  },
  {
    name: 'JavaScript with template literals',
    lang: 'javascript',
    code: 'const x = `<div>${name}</div>`;\nif (a < b && c > d) { console.log("ok"); }\n',
  },
  {
    name: 'JavaScript with imports and functions',
    lang: 'javascript',
    code: "import { logger } from './logging-forms.js'\n\nexport function is_small_screen() {\n  return ($(window).width() < 768);\n}\n\nexport function get_random_string() {\n  var elems = '1234567890qwertyuiopasdfghjklzxcvbnm'.split('');\n  var s = \"\";\n  for(var i = 0; i < length; i++) {\n    s += elems[Math.floor(Math.random() * elems.length)];\n  }\n  return s;\n}\n",
  },
];

function codeBlockJSON(content, lang) {
  return {
    type: 'doc',
    content: [{
      type: 'codeBlock',
      attrs: { language: lang },
      content: [{ type: 'text', text: content }],
    }],
  };
}

let passed = 0;
let failed = 0;

for (const sample of CODE_SAMPLES) {
  const json = codeBlockJSON(sample.code, sample.lang);

  const codeBlockNode = json.content[0];
  const textContent = codeBlockNode.content[0].text;

  if (textContent !== sample.code) {
    console.error(`FAIL [${sample.name}]: JSON text mismatch`);
    console.error('  expected:', JSON.stringify(sample.code));
    console.error('  got:     ', JSON.stringify(textContent));
    failed++;
    continue;
  }

  const html = generateHTML(json, extensions);

  const roundTrippedJson = generateJSON(html, extensions);
  const rtCodeBlock = roundTrippedJson.content && roundTrippedJson.content.find(n => n.type === 'codeBlock');

  if (!rtCodeBlock) {
    console.error(`FAIL [${sample.name}]: no codeBlock after round-trip`);
    console.error('  html:', html);
    console.error('  json:', JSON.stringify(roundTrippedJson, null, 2));
    failed++;
    continue;
  }

  const rtLang = rtCodeBlock.attrs && rtCodeBlock.attrs.language;
  if (rtLang !== sample.lang) {
    console.error(`FAIL [${sample.name}]: language mismatch after round-trip: got "${rtLang}", expected "${sample.lang}"`);
    failed++;
    continue;
  }

  const rtText = rtCodeBlock.content
    ? rtCodeBlock.content.map(n => n.text || '').join('')
    : '';

  if (rtText !== sample.code) {
    console.error(`FAIL [${sample.name}]: text mismatch after round-trip`);
    console.error('  expected:', JSON.stringify(sample.code));
    console.error('  got:     ', JSON.stringify(rtText));
    failed++;
    continue;
  }

  console.log(`PASS [${sample.name}]`);
  passed++;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
