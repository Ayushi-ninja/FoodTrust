import * as fs from 'fs';
import * as path from 'path';

try {
  const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8');
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.substring(0, eqIdx).trim();
        let val = trimmed.substring(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val;
      }
    }
  });
} catch (e) {
  console.warn('Could not load .env.local:', e);
}

if (!globalThis.WebSocket) {
  // @ts-ignore
  globalThis.WebSocket = class DummyWebSocket {};
}

import { getAdminSupabase } from '../lib/supabase/admin';

async function testBucketCreation() {
  const adminClient = getAdminSupabase();
  const { data, error } = await adminClient.storage.createBucket('proof-photos', {
    public: false,
    fileSizeLimit: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  });
  console.log('CREATE BUCKET RESULT:', data, 'ERROR:', error);

  const { data: buckets } = await adminClient.storage.listBuckets();
  console.log('CURRENT BUCKETS:', buckets);
}

testBucketCreation().catch(console.error);
