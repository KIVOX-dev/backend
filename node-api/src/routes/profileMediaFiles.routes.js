const path = require('path');
const express = require('express');
const { verify } = require('../utils/signedUrl');
const { LOCAL_URL_PREFIX, SAFE_OBJECT_NAME } = require('../utils/privateMedia');
const { uploadDir } = require('../middlewares/upload');

// Serves onboarding photos/signatures stored on local disk — the fallback
// when GCS_BUCKET_NAME is unset (dev/tests), plus rows written before
// uploads moved to GCS. Used to be a plain, public express.static mount;
// every request now needs a short-lived signature, minted only when the file
// reference appears in a response the caller was already allowed to see
// (see middlewares/signPrivateMedia.js and utils/privateMedia.js).
const router = express.Router();

router.get('/:filename', (req, res) => {
  const { filename } = req.params;
  if (!SAFE_OBJECT_NAME.test(filename)) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }
  if (!verify(`${LOCAL_URL_PREFIX}${filename}`, req.query.token, req.query.exp)) {
    return res.status(403).json({ success: false, message: 'This link has expired or is invalid — reload the page.' });
  }
  res.set('Cache-Control', 'private, max-age=300');
  return res.sendFile(path.join(uploadDir, filename), (err) => {
    if (err && !res.headersSent) res.status(404).json({ success: false, message: 'File not found' });
  });
});

module.exports = router;
