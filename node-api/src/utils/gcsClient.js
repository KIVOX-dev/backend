const { Storage } = require('@google-cloud/storage');
const ApiError = require('./ApiError');
const logger = require('./logger');

// On Cloud Run this picks up Application Default Credentials from the
// attached service account automatically — no key file needed. Locally it
// falls back to `gcloud auth application-default login` or
// GOOGLE_APPLICATION_CREDENTIALS, same as any other google-auth-library
// consumer in this codebase (see aiServiceClient.js's GoogleAuth usage).
const storage = new Storage();

// Every object this app writes is private — nothing is ever granted
// `allUsers` read. Callers either serve the bytes back themselves through
// an access-checked route (placement-proof offer letters, via downloadFile
// below) or hand out a short-lived V4 signed URL (profile photos, via
// signReadUrl below and utils/privateMedia.js). `cacheControl` defaults to
// no-store; profile photos pass a short private max-age instead so a
// browser can reuse the image for as long as its signed URL is valid.
async function uploadPrivateFile(buffer, { bucketName, destination, contentType, cacheControl = 'private, no-store' }) {
  try {
    await storage.bucket(bucketName).file(destination).save(buffer, {
      contentType,
      resumable: false,
      metadata: { cacheControl },
    });
  } catch (err) {
    logger.error('GCS upload failed', { destination, error: err.message });
    throw ApiError.serviceUnavailable("Couldn't upload the file right now — try again shortly");
  }
}

// Resolves to { buffer, contentType }, or null if the object doesn't exist.
async function downloadFile({ bucketName, destination }) {
  const file = storage.bucket(bucketName).file(destination);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [[buffer], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
  return { buffer, contentType: metadata.contentType };
}

// Short-lived, read-only V4 signed URL for one object. On Cloud Run the
// runtime service account has no private key, so the library signs through
// the IAM Credentials API (signBlob) — that needs the service account to
// hold roles/iam.serviceAccountTokenCreator on itself (see
// docs/OPERATIONS.md, "Private profile photos").
async function signReadUrl({ bucketName, destination, ttlSeconds }) {
  const [url] = await storage.bucket(bucketName).file(destination).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + ttlSeconds * 1000,
  });
  return url;
}

module.exports = { uploadPrivateFile, downloadFile, signReadUrl };
