const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const { parseRef } = require('./privateMedia');
const sharp = require('sharp');
const { deleteFile } = require('./gcsClient');
const ApiError = require('./ApiError');
const logger = require('./logger');

// Logos are resized on upload to fit this box (email clients render them at
// ~200px wide; 400x160 keeps them sharp on high-DPI screens) and always
// re-encoded as PNG, which every email client displays. Decoding and
// re-encoding also strips any metadata or payload smuggled into the file.
const LOGO_MAX_WIDTH = 400;
const LOGO_MAX_HEIGHT = 160;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_PIXELS = 25_000_000;

async function normalizeLogo(buffer) {
  try {
    return await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: LOGO_MAX_WIDTH, height: LOGO_MAX_HEIGHT, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (err) {
    logger.warn('Logo could not be processed', { error: err.message });
    throw ApiError.badRequest('The logo could not be read as an image.');
  }
}

// Logos uploaded while GCS_PUBLIC_LOGO_BUCKET is set live in that public
// bucket, and company_logo_url holds their direct public URL (what emails
// use). Older logos are still private storage references.
const PUBLIC_LOGO_OBJECT = /^company-logo\/[A-Za-z0-9_-]+\.png$/;

function publicLogoPrefix() {
  return env.gcs.publicLogoBucket ? `https://storage.googleapis.com/${env.gcs.publicLogoBucket}/` : null;
}

// Returns the object name inside the public logo bucket, or null if `value`
// is not one of this app's own public logo URLs.
function publicLogoObject(value) {
  const prefix = publicLogoPrefix();
  if (!prefix || typeof value !== 'string' || !value.startsWith(prefix)) return null;
  const objectPath = value.slice(prefix.length);
  return PUBLIC_LOGO_OBJECT.test(objectPath) ? objectPath : null;
}

// The URL to put in an email, or '' (the template then falls back to the
// company name as text) for a drive with no logo or only a legacy private one.
function emailLogoUrl(value) {
  return publicLogoObject(value) ? value : '';
}

// A vacancy's company_logo_url is a reference produced by the logo upload
// endpoint — never an arbitrary URL — so a client can't point a posting at a
// tracking pixel or someone else's bucket. Either one of this app's own
// public logo URLs, or a private reference parseRef trusts.
function assertLogoRef(value) {
  if (value === null || value === '' || value === undefined) return null;
  if (publicLogoObject(value)) return value;
  const ref = parseRef(value);
  const ok = ref && (ref.kind === 'gcs' ? ref.objectPath.startsWith('company-logo/') : ref.filename.startsWith('logo-'));
  if (!ok) {
    throw ApiError.badRequest('company_logo_url must be a logo uploaded through the logo upload endpoint', null, 'INVALID_LOGO');
  }
  return value;
}

// Best-effort delete of a replaced/removed logo's file; never fails the request.
async function removeLogo(value) {
  const publicObject = publicLogoObject(value);
  if (publicObject) {
    try {
      await deleteFile({ bucketName: env.gcs.publicLogoBucket, destination: publicObject });
    } catch (err) {
      logger.error('Failed to delete public company logo', { error: err.message });
    }
    return;
  }
  const ref = value ? parseRef(value) : null;
  if (!ref) return;
  try {
    if (ref.kind === 'gcs') {
      if (ref.objectPath.startsWith('company-logo/')) await deleteFile({ bucketName: ref.bucket, destination: ref.objectPath });
    } else if (ref.filename.startsWith('logo-')) {
      await fs.promises.rm(path.join(process.cwd(), 'uploads', 'profile', ref.filename), { force: true });
    }
  } catch (err) {
    logger.error('Failed to delete company logo', { error: err.message, bucket: env.gcs.bucketName });
  }
}

module.exports = { assertLogoRef, removeLogo, normalizeLogo, emailLogoUrl, LOGO_MAX_BYTES };
