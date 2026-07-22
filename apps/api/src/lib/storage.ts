import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

function s3Configured(): boolean {
  return Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);
}

export function isObjectStorageEnabled(): boolean {
  return s3Configured();
}

function client(): S3Client {
  const endpoint = process.env.S3_ENDPOINT || undefined;
  return new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint,
    forcePathStyle: Boolean(endpoint),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });
}

export async function putAttachmentObject(opts: {
  organizationId: string;
  ticketId: string;
  fileName: string;
  contentType?: string | null;
  body: Buffer;
}): Promise<{ storageKey: string; sizeBytes: number }> {
  const safeName = opts.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
  const storageKey = `org/${opts.organizationId}/tickets/${opts.ticketId}/${randomUUID()}-${safeName}`;
  const bucket = process.env.S3_BUCKET!;
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: opts.body,
      ContentType: opts.contentType || 'application/octet-stream',
    })
  );
  return { storageKey, sizeBytes: opts.body.length };
}

export async function getAttachmentSignedUrl(storageKey: string, expiresIn = 3600): Promise<string> {
  const bucket = process.env.S3_BUCKET!;
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
    { expiresIn }
  );
}

export async function deleteAttachmentObject(storageKey: string): Promise<void> {
  const bucket = process.env.S3_BUCKET!;
  await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
}
