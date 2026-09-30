const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const ApiError = require('./ApiError');
const { uploadPrivateFile, downloadFile, deleteFile } = require('./gcsClient');
const { documentUploadDir } = require('../middlewares/upload');

// Placement-proof offer letters, one folder per institution:
//   placement-proof/<institution_id>/<uuid>.<ext>
// so one college's documents never sit alongside another's. Stored in GCS
// (env.gcs.documentsBucketName) — Cloud Run's local disk is wiped on every
// restart/redeploy, which is how offer letters used to go missing. Falls
// back to local disk, same layout, only when no bucket is configured
// (local dev/tests).
//
// The record's proof_url keeps the /uploads/placement-proof/... shape it has
// always had, so signed-URL minting (utils/signedUrl.js) and serving
// (routes/placementProofFiles.routes.js) work unchanged for old and new rows.

const URL_PREFIX = '/uploads/placement-proof';
const OBJECT_PREFIX = 'placement-proof';
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/;

const CONTENT_TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

function isSafeSegment(segment) {
  return typeof segment === 'string' && SAFE_SEGMENT.test(segment);
}

// Returns the proof_url to store on the record.
async function save(buffer, { institutionId, extension, contentType }) {
  const folder = String(institutionId);
  if (!isSafeSegment(folder)) throw new Error(`Unsafe institution id for storage path: ${folder}`);
  const filename = `${crypto.randomUUID()}${extension}`;

  if (env.gcs.documentsBucketName) {
    await uploadPrivateFile(buffer, {
      bucketName: env.gcs.documentsBucketName,
      destination: `${OBJECT_PREFIX}/${folder}/${filename}`,
      contentType,
    });
  } else if (env.isProduction) {
    // Cloud Run's disk is wiped on every redeploy/restart, so a letter saved
    // there is silently lost later — that is how offer letters went missing.
    // Refuse the upload now instead of accepting a file we can't keep.
    throw ApiError.serviceUnavailable("Document storage isn't configured — the offer letter wasn't saved. Contact support.");
  } else {
    const dir = path.join(documentUploadDir, folder);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, filename), buffer);
  }
  return `${URL_PREFIX}/${folder}/${filename}`;
}

// `segments` is the path under placement-proof/: [institutionId, filename]
// for current uploads, or [filename] for legacy flat-layout ones. Resolves
// to { buffer, contentType } or null.
async function load(segments) {
  if (!segments.every(isSafeSegment)) return null;
  const contentType = CONTENT_TYPES[path.extname(segments[segments.length - 1]).toLowerCase()];

  if (env.gcs.documentsBucketName) {
    const found = await downloadFile({
      bucketName: env.gcs.documentsBucketName,
      destination: [OBJECT_PREFIX, ...segments].join('/'),
    });
    if (found) return { buffer: found.buffer, contentType: found.contentType || contentType };
  }

  // Local disk: dev/tests, plus any legacy file still on this instance.
  const filePath = path.join(documentUploadDir, ...segments);
  try {
    return { buffer: await fs.promises.readFile(filePath), contentType };
  } catch {
    return null;
  }
}

// Deletes the file behind a record's proof_url. Only an admin deleting the
// record reaches this — nothing else removes offer letters. Returns quietly
// for a url that isn't ours or a file that's already gone.
async function remove(proofUrl) {
  if (typeof proofUrl !== 'string' || !proofUrl.startsWith(`${URL_PREFIX}/`)) return;
  const segments = proofUrl.slice(URL_PREFIX.length + 1).split('/');
  if (!segments.every(isSafeSegment)) return;

  if (env.gcs.documentsBucketName) {
    await deleteFile({
      bucketName: env.gcs.documentsBucketName,
      destination: [OBJECT_PREFIX, ...segments].join('/'),
    });
  }
  await fs.promises.rm(path.join(documentUploadDir, ...segments), { force: true });
}

module.exports = { save, load, remove, URL_PREFIX };
