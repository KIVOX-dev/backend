const { createDocumentStorage } = require('./documentStorage');

// Employee documents (ID proofs, contracts, certificates):
//   employee-docs/<org_id>/<uuid>.<ext>
// See utils/documentStorage.js for how storage, durability and deletion work.
module.exports = createDocumentStorage({
  urlPrefix: '/uploads/employee-docs',
  objectPrefix: 'employee-docs',
});
