const createCrudController = require('./crudControllerFactory');
const collegeAdminService = require('../services/collegeAdmin.service');

module.exports = createCrudController(collegeAdminService);
