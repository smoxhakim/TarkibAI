/**
 * Cloudflare R2 configuration.
 *
 * As with the AI layer, the application must stay usable when storage is not
 * configured: file endpoints report 503 and the UI says so, rather than the
 * project workspace failing to render.
 */
export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export function readR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function isStorageConfigured(): boolean {
  return readR2Config() !== null;
}

/**
 * Object key prefix. Development and production are separated so a local
 * experiment can never overwrite or expose a real project's asset.
 */
export function environmentPrefix(): string {
  return process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
}
