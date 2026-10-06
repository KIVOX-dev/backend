const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const { parseRef } = require('./privateMedia');
const { deleteFile } = require('./gcsClient');
const ApiError = require('./ApiError');
const logger = require('./logger');

// A vacancy's company_logo_url is a private storage reference produced by the
// logo upload endpoint — never an arbitrary URL — so a client can't point a
// posting at a tracking pixel or someone else's bucket. The one exception is
// the same-origin references parseRef already trusts.
function assertLogoRef(value) {
  if (value === null || value === '' || value === undefined) return null;
  const ref = parseRef(value);
  const ok = ref && (ref.kind === 'gcs' ? ref.objectPath.startsWith('company-logo/') : ref.filename.startsWith('logo-'));
  if (!ok) {
    throw ApiError.badRequest('company_logo_url must be a logo uploaded through the logo upload endpoint', null, 'INVALID_LOGO');
  }
  return value;
}

// Best-effort delete of a replaced/removed logo's file; never fails the request.
async function removeLogo(value) {
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

module.exports = { assertLogoRef, removeLogo };
