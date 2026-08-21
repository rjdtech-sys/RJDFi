const { buildSync } = require('esbuild');
const path = require('path');
const fs = require('fs');

console.log('🔒 Building & Protecting Backend Licensing Modules...');

const files = [
  'lib/license.js',
  'lib/edge-sync.js',
  'lib/trial.js',
  'lib/nodemcu-license.js'
];

files.forEach(file => {
  const srcPath = path.join(__dirname, '..', file);
  const distPath = path.join(__dirname, '..', 'dist', file);
  const distDir = path.dirname(distPath);

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  buildSync({
    entryPoints: [srcPath],
    outfile: distPath,
    bundle: false,
    minify: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    platform: 'node',
    target: 'node16'
  });

  console.log(`✅ Protected module created: dist/${file}`);
});

console.log('🔒 Protected Backend Modules Build Complete!');
