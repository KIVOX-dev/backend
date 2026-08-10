const createCrudController = require('./crudControllerFactory');
const collegeAdminService = require('../services/collegeAdmin.service');

const base = createCrudController(collegeAdminService);

// collegeAdminService.list() needs `actor` for institution scoping.
module.exports = { ...base, list: base.listWithActor };
