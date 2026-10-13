import * as fs from 'fs';
import * as path from 'path';
import dns from 'dns';

if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

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

async function checkStorage() {
  const adminClient = getAdminSupabase();
  const { data: buckets, error } = await adminClient.storage.listBuckets();
  console.log('BUCKETS:', JSON.stringify(buckets, null, 2));
  if (error) console.error('BUCKET ERROR:', error);
}

checkStorage().catch(console.error);
