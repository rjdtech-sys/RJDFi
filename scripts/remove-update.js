#!/usr/bin/env node
/**
 * Remove buggy update files from Supabase Storage
 */
const fs = require('fs');
const path = require('path');

// Read .env
const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const SUPABASE_URL = envContent.match(/^SUPABASE_URL=(.+)$/m)?.[1]?.trim();
const SUPABASE_SERVICE_ROLE_KEY = envContent.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const BUCKET = 'UPDATE FILE';
const FOLDER = 'system';

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // List all files in the system folder
  console.log('Listing files in storage bucket...');
  const { data: files, error } = await supabase.storage.from(BUCKET).list(FOLDER);
  
  if (error) {
    console.error('Error listing files:', error.message);
    process.exit(1);
  }

  console.log(`Found ${files.length} files:`);
  files.forEach(f => console.log(`  - ${f.name}`));

  // Delete all files in the system folder
  const fileNames = files.map(f => f.name);
  if (fileNames.length > 0) {
    console.log(`\nDeleting ${fileNames.length} files...`);
    const { error: deleteError } = await supabase.storage.from(BUCKET).remove(fileNames);
    if (deleteError) {
      console.error('Error deleting files:', deleteError.message);
    } else {
      console.log('✅ All update files removed from Supabase Storage');
    }
  } else {
    console.log('No files to delete.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
