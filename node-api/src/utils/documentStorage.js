const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const ApiError = require('./ApiError');
const { uploadPrivateFile, downloadFile, deleteFile } = require('./gcsClient');

// Private, per-institution document storage — offer letters, admission
// proofs, exam score cards. Each kind gets its own bucket prefix and URL
// prefix, but the rules are the same:
//   <objectPrefix>/<institution_id>/<uuid>.<ext>
// Stored in GCS (env.gcs.documentsBucketName) because Cloud Run's local disk
// is wiped on every restart/redeploy — which is how offer letters used to go
// missing. Local disk, same layout, only when no bucket is configured
// (local dev/tests); production refuses instead of silently losing the file.
//
// The record keeps a /uploads/<kind>/... style url so signed-URL minting
// (utils/signedUrl.js) and serving (routes/documentFiles.routes.js) work the
// same way for every kind of document.

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/;
const CONTENT_TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

function isSafeSegment(segment) {
  return typeof segment === 'string' && SAFE_SEGMENT.test(segment);
}

function createDocumentStorage({ urlPrefix, objectPrefix }) {
  const localDir = path.join(process.cwd(), 'uploads', objectPrefix);

  // Returns the url to store on the record.
  async function save(buffer, { institutionId, extension, contentType }) {
    const folder = String(institutionId);
    if (!isSafeSegment(folder)) throw new Error(`Unsafe institution id for storage path: ${folder}`);
    const filename = `${crypto.randomUUID()}${extension}`;

    if (env.gcs.documentsBucketName) {
      await uploadPrivateFile(buffer, {
        bucketName: env.gcs.documentsBucketName,
        destination: `${objectPrefix}/${folder}/${filename}`,
        contentType,
      });
    } else if (env.isProduction) {
      // A letter saved to Cloud Run's disk is silently lost on the next
      // redeploy. Refuse the upload now instead of accepting a file we
      // can't keep.
      throw ApiError.serviceUnavailable("Document storage isn't configured — the document wasn't saved. Contact support.");
    } else {
      const dir = path.join(localDir, folder);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, filename), buffer);
    }
    return `${urlPrefix}/${folder}/${filename}`;
  }

  // `segments` is the path under the prefix: [institutionId, filename] for
  // current uploads, or [filename] for the legacy flat layout. Resolves to
  // { buffer, contentType } or null.
  async function load(segments) {
    if (!segments.every(isSafeSegment)) return null;
    const contentType = CONTENT_TYPES[path.extname(segments[segments.length - 1]).toLowerCase()];

    if (env.gcs.documentsBucketName) {
      const found = await downloadFile({
        bucketName: env.gcs.documentsBucketName,
        destination: [objectPrefix, ...segments].join('/'),
      });
      if (found) return { buffer: found.buffer, contentType: found.contentType || contentType };
    }

    // Local disk: dev/tests, plus any legacy file still on this instance.
    try {
      return { buffer: await fs.promises.readFile(path.join(localDir, ...segments)), contentType };
    } catch {
      return null;
    }
  }

  // Deletes the file behind a stored url. Only an admin deleting the record
  // reaches this — nothing else removes documents. Returns quietly for a url
  // that isn't ours or a file that's already gone.
  async function remove(storedUrl) {
    if (typeof storedUrl !== 'string' || !storedUrl.startsWith(`${urlPrefix}/`)) return;
    const segments = storedUrl.slice(urlPrefix.length + 1).split('/');
    if (!segments.every(isSafeSegment)) return;

    if (env.gcs.documentsBucketName) {
      await deleteFile({
        bucketName: env.gcs.documentsBucketName,
        destination: [objectPrefix, ...segments].join('/'),
      });
    }
    await fs.promises.rm(path.join(localDir, ...segments), { force: true });
  }

  return { save, load, remove, URL_PREFIX: urlPrefix };
}

module.exports = { createDocumentStorage };
