const { createDocumentStorage } = require('./documentStorage');

// Higher-study admission proofs and competitive-exam score cards:
//   outcome-proof/<institution_id>/<uuid>.<ext>
// Same bucket and rules as offer letters, kept under its own prefix so the
// two kinds of document never share a url namespace.
module.exports = createDocumentStorage({
  urlPrefix: '/uploads/outcome-proof',
  objectPrefix: 'outcome-proof',
});
