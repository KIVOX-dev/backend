const express = require('express');
const { verify } = require('../utils/signedUrl');
const asyncHandler = require('../utils/asyncHandler');

// Serves stored documents (offer letters, admission proofs, score cards).
// Replaces the old plain express.static('/uploads') serving of these
// directories (PROJECT_AUDIT_REPORT.md P1-7 — salary/employer PDFs were
// reachable by anyone with the URL, protected only by an unguessable UUID
// filename). Every request here must carry a valid short-lived signature
// minted by an authenticated "…/proof-url" endpoint, which is itself gated by
// the same ownership check every other per-record endpoint uses — see
// utils/signedUrl.js for why a signed URL rather than a Bearer-auth route
// (this gets opened in a new browser tab, which can't carry an Authorization
// header).
//
// Files live under <prefix>/<institution_id>/<file>; /:filename alone is the
// legacy flat layout from before per-institution folders.
function createDocumentFilesRoutes(storage) {
  const router = express.Router();

  const serve = asyncHandler(async (req, res) => {
    const segments = req.params.institutionId ? [req.params.institutionId, req.params.filename] : [req.params.filename];
    // The signature is computed over this exact path, so any tampered segment
    // fails verification; load() additionally rejects anything but plain
    // [A-Za-z0-9_-] names — defense in depth against traversal.
    const relativePath = `${storage.URL_PREFIX}/${segments.join('/')}`;

    if (!verify(relativePath, req.query.token, req.query.exp)) {
      return res.status(403).json({ success: false, message: 'This link has expired or is invalid — request a new one.' });
    }

    const file = await storage.load(segments);
    if (!file) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }
    res.set('Cache-Control', 'private, no-store');
    if (file.contentType) res.type(file.contentType);
    return res.send(file.buffer);
  });

  router.get('/:institutionId/:filename', serve);
  router.get('/:filename', serve);
  return router;
}

module.exports = { createDocumentFilesRoutes };
