// Backfill inline/data URL images into Supabase Storage.
// Usage (from repo root):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-images-to-storage.mjs
//
// Only images whose current value starts with "data:" are migrated.
// For each such row we:
//   - Decode the data URL to binary
//   - Upload to the `scorekpr-media` bucket under a stable path
//   - Replace the column's image with the public URL
//   - Set the matching *_storage_path column to the Storage path

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'scorekpr-media';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) return null;
  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  return { mimeType, buffer };
}

function extFromMime(mime) {
  if (!mime) return 'bin';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/svg+xml') return 'svg';
  if (mime === 'image/gif') return 'gif';
  return 'bin';
}

async function uploadToStorage(path, buffer, contentType) {
  const bucket = supabase.storage.from(STORAGE_BUCKET);
  const { error } = await bucket.upload(path, buffer, {
    contentType,
    upsert: true
  });
  if (error) throw error;
  const { data } = bucket.getPublicUrl(path);
  return { path, publicUrl: data?.publicUrl || null };
}

async function backfillTable({ table, idColumn, imageColumn, storagePathColumn, pathPrefix }) {
  console.log(`\nBackfilling ${table}...`);
  const pageSize = 100;
  let offset = 0;
  let totalProcessed = 0;

  while (true) {
    const { data: rows, error } = await supabase
      .from(table)
      .select(`${idColumn}, ${imageColumn}, ${storagePathColumn}`)
      .is(storagePathColumn, null)
      .like(imageColumn, 'data:%')
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error(`Error querying ${table}:`, error.message || error);
      break;
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const id = row[idColumn];
      const imageVal = row[imageColumn];
      const parsed = parseDataUrl(imageVal);
      if (!parsed) {
        console.warn(`Skipping ${table}.${idColumn}=${id}: not a valid data URL`);
        continue;
      }
      const { mimeType, buffer } = parsed;
      const ext = extFromMime(mimeType);
      const path = `${pathPrefix}/${id}.${ext}`;
      try {
        const { publicUrl } = await uploadToStorage(path, buffer, mimeType || 'application/octet-stream');
        const updates = {
          [imageColumn]: publicUrl || imageVal,
          [storagePathColumn]: path
        };
        const { error: updateError } = await supabase
          .from(table)
          .update(updates)
          .eq(idColumn, id);
        if (updateError) throw updateError;
        totalProcessed += 1;
        console.log(`✓ ${table}.${idColumn}=${id} → ${path}`);
      } catch (e) {
        console.error(`✗ Failed for ${table}.${idColumn}=${id}:`, e.message || e);
      }
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`Finished ${table}: ${totalProcessed} row(s) migrated.`);
}

async function main() {
  console.log('Starting image backfill to Supabase Storage...');
  console.log(`Project: ${SUPABASE_URL}`);
  console.log(`Bucket:  ${STORAGE_BUCKET}`);

  await backfillTable({
    table: 'game_metadata',
    idColumn: 'game_id',
    imageColumn: 'image',
    storagePathColumn: 'image_storage_path',
    pathPrefix: 'images/games'
  });

  await backfillTable({
    table: 'player_metadata',
    idColumn: 'player_id',
    imageColumn: 'image',
    storagePathColumn: 'image_storage_path',
    pathPrefix: 'avatars/players'
  });

  await backfillTable({
    table: 'preset_avatars',
    idColumn: 'id',
    imageColumn: 'image_url',
    storagePathColumn: 'image_storage_path',
    pathPrefix: 'avatars/presets'
  });

  console.log('\nBackfill complete.');
}

main().catch((err) => {
  console.error('Unexpected error during backfill:', err);
  process.exit(1);
});

