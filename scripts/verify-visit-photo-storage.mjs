import { randomUUID } from 'node:crypto';
import { put, get, del } from '@vercel/blob';
import { visitPhotoStorageAuth } from '../src/lib/server/visit-photo-storage-auth.ts';

// Opt-in release smoke only. No application rows, customer files or workers.
if (process.env.VERIFY_PRIVATE_VISIT_STORAGE !== '1') throw new Error('Explicit private-storage release smoke opt-in required.');
const auth = await visitPhotoStorageAuth();
if (!auth) throw new Error('Visit-photo private storage authentication is unavailable.');
const path = `visit-photos/release-smoke/${randomUUID()}.png`;
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN8sAAAAASUVORK5CYII=', 'base64');
let attempted = false;
try {
  attempted = true;
  const blob = await put(path, bytes, { ...auth, access: 'private', contentType: 'image/png', addRandomSuffix: false, allowOverwrite: false });
  const result = await get(path, { ...auth, access: 'private' });
  if (result?.statusCode !== 200) throw new Error('Authenticated private read failed.');
  const read = Buffer.from(await new Response(result.stream).arrayBuffer());
  if (!read.equals(bytes)) throw new Error('Private storage byte comparison failed.');
  const anonymous = await fetch(blob.url, { signal: AbortSignal.timeout(15000) });
  if (![401,403,404].includes(anonymous.status)) throw new Error('Private file was accessible anonymously.');
  console.log(JSON.stringify({ privateVisitStorage: 'passed', byteMatch: true, anonymousStatus: anonymous.status, authMode: 'token' in auth ? 'scoped-token' : 'oidc' }));
} catch (error) {
  console.error(JSON.stringify({ privateVisitStorage: 'failed', errorName: error instanceof Error ? error.name : 'UnknownError' }));
  process.exitCode = 1;
} finally {
  if (attempted) {
    try { await del(path, auth); console.log(JSON.stringify({ syntheticPrivateBlobCleanup: 'completed' })); }
    catch { console.error(JSON.stringify({ syntheticPrivateBlobCleanup: 'failed' })); process.exitCode = 1; }
  }
}
