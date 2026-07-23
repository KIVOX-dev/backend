const createCrudController = require('./crudControllerFactory');
const departmentService = require('../services/department.service');

module.exports = createCrudController(departmentService);
