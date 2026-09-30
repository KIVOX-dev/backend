const { createDocumentFilesRoutes } = require('./documentFiles.routes');
const placementProofStorage = require('../utils/placementProofStorage');

// Offer letters — see routes/documentFiles.routes.js.
module.exports = createDocumentFilesRoutes(placementProofStorage);
