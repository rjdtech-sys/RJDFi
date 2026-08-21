const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const obfuscateOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  numbersToExpressions: true,
  simplify: true,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.8,
  splitStrings: true,
  splitStringsChunkLength: 10,
  target: 'node',
  selfDefending: false
};

const filesToObfuscate = [
  'lib/license.js',
  'lib/edge-sync.js',
  'lib/trial.js',
  'lib/nodemcu-license.js'
];

console.log('🔒 Starting Backend Code Obfuscation & Protection...');

filesToObfuscate.forEach(relativePath => {
  const fullPath = path.join(__dirname, '..', relativePath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`[Obfuscator] Warning: File not found ${relativePath}`);
    return;
  }

  const sourceCode = fs.readFileSync(fullPath, 'utf8');
  const obfuscatedResult = JavaScriptObfuscator.obfuscate(sourceCode, obfuscateOptions);
  
  // Save output in dist/lib/
  const outputDir = path.join(__dirname, '..', 'dist', path.dirname(relativePath));
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(__dirname, '..', 'dist', relativePath);
  fs.writeFileSync(outputPath, obfuscatedResult.getObfuscatedCode(), 'utf8');
  console.log(`✅ Protection Applied: ${relativePath} -> dist/${relativePath}`);
});

console.log('🔒 Backend Code Obfuscation Complete!');
