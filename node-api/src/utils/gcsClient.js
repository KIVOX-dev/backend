const { Storage } = require('@google-cloud/storage');
const env = require('../config/env');
const ApiError = require('./ApiError');
const logger = require('./logger');

// On Cloud Run this picks up Application Default Credentials from the
// attached service account automatically — no key file needed. Locally it
// falls back to `gcloud auth application-default login` or
// GOOGLE_APPLICATION_CREDENTIALS, same as any other google-auth-library
// consumer in this codebase (see aiServiceClient.js's GoogleAuth usage).
const storage = new Storage();

// Requires the bucket to grant `allUsers` the `roles/storage.objectViewer`
// IAM role (bucket-level, since new buckets default to uniform
// bucket-level access — per-object `predefinedAcl` doesn't work there) —
// profile photos/covers are meant to be publicly viewable on a shared
// profile, same as any other social-profile avatar.
async function uploadPublicFile(buffer, { destination, contentType }) {
  if (!env.gcs.bucketName) {
    throw ApiError.serviceUnavailable('Image uploads are not configured');
  }

  try {
    const bucket = storage.bucket(env.gcs.bucketName);
    const file = bucket.file(destination);
    await file.save(buffer, {
      contentType,
      resumable: false,
      metadata: { cacheControl: 'public, max-age=31536000, immutable' },
    });
    return `https://storage.googleapis.com/${env.gcs.bucketName}/${destination}`;
  } catch (err) {
    logger.error('GCS upload failed', { destination, error: err.message });
    throw ApiError.serviceUnavailable("Couldn't upload the image right now — try again shortly");
  }
}

// For documents that must never get a public URL (placement-proof offer
// letters). Unlike uploadPublicFile this returns no URL at all — callers
// serve the bytes back themselves through an access-checked route
// (routes/placementProofFiles.routes.js), via downloadFile below.
async function uploadPrivateFile(buffer, { bucketName, destination, contentType }) {
  try {
    await storage.bucket(bucketName).file(destination).save(buffer, {
      contentType,
      resumable: false,
      metadata: { cacheControl: 'private, no-store' },
    });
  } catch (err) {
    logger.error('GCS upload failed', { destination, error: err.message });
    throw ApiError.serviceUnavailable("Couldn't upload the document right now — try again shortly");
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

module.exports = { uploadPublicFile, uploadPrivateFile, downloadFile };
