const createCrudController = require('./crudControllerFactory');
const facultyService = require('../services/faculty.service');

const base = createCrudController(facultyService);

// facultyService.list() needs `actor` for institution scoping.
module.exports = { ...base, list: base.listWithActor };
