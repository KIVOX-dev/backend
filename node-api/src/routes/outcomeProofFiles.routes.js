const { createDocumentFilesRoutes } = require('./documentFiles.routes');
const outcomeProofStorage = require('../utils/outcomeProofStorage');

// Admission proofs and exam score cards — see routes/documentFiles.routes.js.
module.exports = createDocumentFilesRoutes(outcomeProofStorage);
