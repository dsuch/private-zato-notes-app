const esbuild = require('esbuild');
const path = require('path');

esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'src', 'renderer.js')],
  bundle: true,
  outfile: path.join(__dirname, 'dist', 'renderer.bundle.js'),
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  define: {
    'process.env.NODE_ENV': '"production"'
  },
});

console.log('Build complete: dist/renderer.bundle.js');
