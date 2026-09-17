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

module.exports = { uploadPublicFile };
