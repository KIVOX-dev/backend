const createCrudController = require('./crudControllerFactory');
const facultyService = require('../services/faculty.service');

module.exports = createCrudController(facultyService);
