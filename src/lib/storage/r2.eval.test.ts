/**
 * Live round trip against the real R2 bucket.
 *
 * Skipped when the R2_* variables are absent, so ordinary test runs need no
 * credentials. Run with: npm run test:eval
 *
 * Beyond "does it work", two assertions here are security properties worth
 * regressing on: an unsigned URL must be refused, and the API token must not
 * reach buckets outside this project.
 */
import { describe, expect, it } from 'vitest';
import { isStorageConfigured } from './config';
import {
  createSignedDownloadUrl,
  createSignedUploadUrl,
  deleteObject,
  getObjectBytes,
  headObject,
} from './r2';

describe.skipIf(!isStorageConfigured())('R2 storage', () => {
  it(
    'completes an upload, verify, read, download and delete cycle',
    async () => {
      const key = `dev/_verify/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
      const payload = Buffer.from(`tarkib verification ${Date.now()}`);

      try {
        // Upload exactly the way the browser does, through a presigned PUT.
        const putUrl = await createSignedUploadUrl(key, 'text/plain');
        const put = await fetch(putUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: new Uint8Array(payload),
        });
        expect(put.ok).toBe(true);

        // What confirmUpload relies on to record the real size.
        const head = await headObject(key);
        expect(head?.sizeBytes).toBe(payload.length);

        // What the vision layer relies on.
        const bytes = await getObjectBytes(key);
        expect(bytes.equals(payload)).toBe(true);

        const getUrl = await createSignedDownloadUrl(key, { downloadName: 'verify.txt' });
        const got = await fetch(getUrl);
        expect(await got.text()).toBe(payload.toString());
        expect(got.headers.get('content-disposition')).toContain('attachment');
      } finally {
        await deleteObject(key);
      }

      expect(await headObject(key)).toBeNull();
    },
    120_000
  );

  it(
    'refuses the same object URL once the signature is stripped',
    async () => {
      const key = `dev/_verify/${Date.now()}-unsigned.txt`;
      try {
        const putUrl = await createSignedUploadUrl(key, 'text/plain');
        await fetch(putUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: new Uint8Array(Buffer.from('private')),
        });

        const signed = await createSignedDownloadUrl(key);
        const unsigned = signed.split('?')[0];

        // The whole private-storage design rests on this being unreachable.
        const denied = await fetch(unsigned);
        expect(denied.status).not.toBe(200);
      } finally {
        await deleteObject(key);
      }
    },
    120_000
  );

  it(
    'uses a token scoped to this project bucket only',
    async () => {
      const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const client = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID!,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        },
      });

      // A bucket this application must never be able to touch. An account-wide
      // token would let a bug here damage an unrelated project's data.
      await expect(
        client.send(new ListObjectsV2Command({ Bucket: 'wearly-dev', MaxKeys: 1 }))
      ).rejects.toThrow();
    },
    120_000
  );
});
