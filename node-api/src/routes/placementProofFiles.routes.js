const path = require('path');
const fs = require('fs');
const express = require('express');
const { verify } = require('../utils/signedUrl');
const { documentUploadDir } = require('../middlewares/upload');

// Replaces the old plain express.static('/uploads') serving of this
// directory (PROJECT_AUDIT_REPORT.md P1-7 — salary/employer placement-proof
// PDFs were reachable by anyone with the URL, no auth, protected only by an
// unguessable UUID filename). Every request here must carry a valid
// short-lived signature minted by
// GET /api/v1/placement-records/:id/proof-url, which is itself gated by the
// same ownership check every other per-record endpoint uses — see
// placementRecord.service.js#getProofUrl and utils/signedUrl.js for why a
// signed URL rather than a Bearer-auth route (this gets opened in a new
// browser tab, which can't carry an Authorization header).
const router = express.Router();

router.get('/:filename', (req, res) => {
  // path.basename strips any directory component — defense in depth against
  // traversal even though Express's :filename segment can't itself contain
  // "/". The signature below is computed over this exact sanitized path, so
  // a mismatched filename fails signature verification anyway.
  const filename = path.basename(req.params.filename);
  const relativePath = `/uploads/placement-proof/${filename}`;

  if (!verify(relativePath, req.query.token, req.query.exp)) {
    return res.status(403).json({ success: false, message: 'This link has expired or is invalid — request a new one.' });
  }

  const filePath = path.join(documentUploadDir, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Document not found' });
  }
  return res.sendFile(filePath);
});

module.exports = router;
