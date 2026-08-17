#!/usr/bin/env node
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const NXS_FILE     = 'RJD-PisoWiFi-v3.12.83-Update.nxs';
const VERSION_NAME = '3.12.83';
const VERSION_CODE = 116;
const NOTES        = 'Fix: "Valid time but no internet" bug - increased kernel settle delay (500ms→800ms) for iptables rule application on slow hardware, aggressive conntrack flush. Analytics: Top Vendo card now includes NodeMCU sales. Previously: Voucher alphanumeric codes, Start Surfing single-press lock.';
const BUCKET       = 'UPDATE FILE';
const FOLDER       = 'system';

const envContent   = fs.readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf8');
const SUPABASE_URL = (envContent.match(/^SUPABASE_URL=(.+)$/m)||[])[1]
                       ? envContent.match(/^SUPABASE_URL=(.+)$/m)[1].trim() : null;
const KEY          = (envContent.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)||[])[1]
                       ? envContent.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)[1].trim()
                       : (envContent.match(/^SUPABASE_ANON_KEY=(.+)$/m)||[])[1]
                         ? envContent.match(/^SUPABASE_ANON_KEY=(.+)$/m)[1].trim() : null;

if (!SUPABASE_URL || !KEY) { console.error('Missing SUPABASE_URL or key'); process.exit(1); }

const BASE = SUPABASE_URL.replace(/\/$/, '');
const HOST = BASE.replace(/^https?:\/\//, '');

function upload(remotePath, buffer, contentType) {
  return new Promise(function(resolve, reject) {
    var urlPath = '/storage/v1/object/' +
                  encodeURIComponent(BUCKET) + '/' +
                  remotePath.split('/').map(encodeURIComponent).join('/');
    var options = {
      hostname: HOST, port: 443, path: urlPath, method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + KEY,
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'x-upsert': 'true'
      }
    };
    var req = https.request(options, function(res) {
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('end', function() {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.statusCode);
        else reject(new Error('HTTP ' + res.statusCode + ' - ' + body));
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, function() { req.destroy(new Error('Timeout')); });
    req.write(buffer);
    req.end();
  });
}

(function run() {
  var nxsPath = path.join(PROJECT_ROOT, NXS_FILE);
  if (!fs.existsSync(nxsPath)) {
    console.log('Rebuilding ' + NXS_FILE + '...');
    require('child_process').execSync(
      'node scripts/build-update.js --version ' + VERSION_NAME + ' --code ' + VERSION_CODE + ' --files "public/js/portal.js,metadata.json,package.json"',
      { cwd: PROJECT_ROOT, stdio: 'inherit' }
    );
  }
  if (!fs.existsSync(nxsPath)) { console.error('Could not build ' + NXS_FILE); process.exit(1); }

  console.log('\nUploading to Supabase bucket: ' + BUCKET + '\n');

  upload(FOLDER + '/' + NXS_FILE, fs.readFileSync(nxsPath), 'application/octet-stream')
    .then(function() {
      console.log('[1/3] OK: ' + NXS_FILE);
      return upload(FOLDER + '/update_release.json', Buffer.from(JSON.stringify({
        version_code: VERSION_CODE, version_name: VERSION_NAME,
        filename: NXS_FILE, release_notes: NOTES,
        published_at: new Date().toISOString(), bucket: BUCKET
      }, null, 2)), 'application/json');
    })
    .then(function() {
      console.log('[2/3] OK: update_release.json');
      return upload(FOLDER + '/latest_release.json', Buffer.from(JSON.stringify({
        version_code: VERSION_CODE, version_name: VERSION_NAME,
        filename: '', release_notes: NOTES,
        published_at: new Date().toISOString(), bucket: BUCKET
      }, null, 2)), 'application/json');
    })
    .then(function() {
      console.log('[3/3] OK: latest_release.json');
      try { fs.unlinkSync(nxsPath); } catch(e) {}
      console.log('\nUPLOAD COMPLETE - v' + VERSION_NAME + ' (code ' + VERSION_CODE + ')');
    })
    .catch(function(err) {
      console.error('UPLOAD FAILED:', err.message);
      process.exit(1);
    });
}());
