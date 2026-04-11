const assert = require('assert');

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

const tests = [
  { input: '', expected: '' },
  { input: null, expected: '' },
  { input: undefined, expected: '' },
  { input: '<p></p>', expected: '' },
  { input: '<p>hello world</p>', expected: 'hello world' },
  { input: '<p>first line</p><p>second line</p>', expected: 'first line' },
  { input: '<p>  leading spaces</p>', expected: '  leading spaces' },
  { input: '<p></p><p>second</p>', expected: '' },
  { input: '<h1>My Title</h1><p>body</p>', expected: 'My Title' },
  { input: '<p>has &amp; ampersand</p>', expected: 'has & ampersand' },
  { input: '<p>has &lt;tag&gt;</p>', expected: 'has <tag>' },
  { input: '<p>   </p>', expected: '   ' },
  { input: '<p>\t\ttabs</p>', expected: '\t\ttabs' },
  { input: '<p>line one<br>line two</p>', expected: 'line one' },
  { input: '<p><strong>bold</strong> text</p>', expected: 'bold text' },
  { input: '<p><code>code</code> and text</p>', expected: 'code and text' },
  { input: '<pre><code>def foo():\n  pass</code></pre>', expected: 'def foo():' },
  { input: '<p>only line</p>', expected: 'only line' },
  { input: '<div>div content</div><p>para</p>', expected: 'div content' },
];

let passed = 0;
let failed = 0;

for (const t of tests) {
  const result = getFirstLineFromHtml(t.input);
  if (result === t.expected) {
    passed++;
    console.log(`PASS: ${JSON.stringify(t.input)} -> ${JSON.stringify(result)}`);
  } else {
    failed++;
    console.error(`FAIL: ${JSON.stringify(t.input)} -> ${JSON.stringify(result)} (expected ${JSON.stringify(t.expected)})`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
