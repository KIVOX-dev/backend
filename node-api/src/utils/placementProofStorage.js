const { createDocumentStorage } = require('./documentStorage');

// Placement-proof offer letters:
//   placement-proof/<institution_id>/<uuid>.<ext>
// See utils/documentStorage.js for how storage, durability and deletion work.
module.exports = createDocumentStorage({
  urlPrefix: '/uploads/placement-proof',
  objectPrefix: 'placement-proof',
});
