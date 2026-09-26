const { signMediaInBody } = require('../utils/privateMedia');
const logger = require('../utils/logger');

// Wraps res.json so every JSON response has its private media references
// (profile photos, covers, signatures — see utils/privateMedia.js) swapped
// for short-lived signed URLs just before sending. Done once here rather than
// in each service, because student records carrying avatar_url come back
// through dozens of routes (profiles, directories, leaderboards, search),
// and one missed call site would mean a broken image at best.
module.exports = function signPrivateMedia(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    signMediaInBody(body).then(originalJson, (err) => {
      // signMediaInBody already turns per-image signing failures into null;
      // reaching here means something unexpected. The unsigned body is still
      // safe to send — a gs:// reference or a now-private bucket URL grants
      // no access on its own.
      logger.error('Failed to sign private media in response', { error: err.message, path: req.originalUrl });
      originalJson(body);
    });
    return res;
  };
  next();
};
