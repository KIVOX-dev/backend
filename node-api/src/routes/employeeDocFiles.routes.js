const { createDocumentFilesRoutes } = require('./documentFiles.routes');
const employeeDocStorage = require('../utils/employeeDocStorage');

// Employee documents — see routes/documentFiles.routes.js.
module.exports = createDocumentFilesRoutes(employeeDocStorage);
