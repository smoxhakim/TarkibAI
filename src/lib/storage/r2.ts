import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ApiError } from '@/lib/http/api';
import { readR2Config } from './config';

/**
 * R2 speaks the S3 API, so the AWS SDK is used against R2's endpoint. Objects
 * are private: the bucket has no public access and nothing hands out a durable
 * URL. Every read is a short-lived signed URL minted after an ownership check.
 */
const SIGNED_PUT_TTL_SECONDS = 300; // 5 minutes to start and finish an upload
const SIGNED_GET_TTL_SECONDS = 300; // 5 minutes to view or download

const storageUnavailable = () =>
  new ApiError(
    503,
    'File storage is not configured on this server. Set the R2_* environment variables to enable uploads.',
    'storage_not_configured'
  );

let cached: { client: S3Client; bucket: string } | null = null;

function getClient(): { client: S3Client; bucket: string } {
  if (cached) return cached;

  const config = readR2Config();
  if (!config) throw storageUnavailable();

  cached = {
    bucket: config.bucket,
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }),
  };
  return cached;
}

/**
 * Signs a PUT the browser uses to upload straight to R2.
 *
 * Content-Type is bound into the signature, so the browser cannot upload a
 * different kind of object than the one the server authorised.
 */
export async function createSignedUploadUrl(objectKey: string, mimeType: string): Promise<string> {
  const { client, bucket } = getClient();
  return getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: objectKey, ContentType: mimeType }),
    { expiresIn: SIGNED_PUT_TTL_SECONDS }
  );
}

export async function createSignedDownloadUrl(
  objectKey: string,
  options: { downloadName?: string } = {}
): Promise<string> {
  const { client, bucket } = getClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      // Quotes and backslashes would break out of the header's quoted string.
      ...(options.downloadName
        ? { ResponseContentDisposition: `attachment; filename="${options.downloadName.replace(/["\\]/g, '')}"` }
        : {}),
    }),
    { expiresIn: SIGNED_GET_TTL_SECONDS }
  );
}

/** Size and type of an object as R2 actually stored it, or null when absent. */
export async function headObject(
  objectKey: string
): Promise<{ sizeBytes: number; mimeType: string | null } | null> {
  const { client, bucket } = getClient();
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    return {
      sizeBytes: result.ContentLength ?? 0,
      mimeType: result.ContentType ?? null,
    };
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === 'NotFound' || name === 'NoSuchKey') return null;
    throw error;
  }
}

export async function getObjectBytes(objectKey: string): Promise<Buffer> {
  const { client, bucket } = getClient();
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  if (!result.Body) throw new Error(`Object has no body: ${objectKey}`);
  return Buffer.from(await result.Body.transformToByteArray());
}

/**
 * Reads the first bytes of an object.
 *
 * A ranged request, because the only caller sniffs a magic number: pulling a
 * 20 MB upload through the app server to read sixteen bytes would be a real
 * cost on every confirmed file.
 */
export async function getObjectPrefix(objectKey: string, byteCount: number): Promise<Buffer> {
  const { client, bucket } = getClient();
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: objectKey, Range: `bytes=0-${byteCount - 1}` })
  );
  if (!result.Body) throw new Error(`Object has no body: ${objectKey}`);
  return Buffer.from(await result.Body.transformToByteArray());
}

/**
 * Writes an object from the server.
 *
 * Distinct from the presigned upload path, which exists so a browser can send
 * large files directly. Generated artefacts — cutting diagrams, and later PDFs
 * — are produced server-side and never pass through a browser at all.
 */
export async function putObject(
  objectKey: string,
  body: Buffer,
  mimeType: string
): Promise<void> {
  const { client, bucket } = getClient();
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: body, ContentType: mimeType })
  );
}

export async function deleteObject(objectKey: string): Promise<void> {
  const { client, bucket } = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
}
