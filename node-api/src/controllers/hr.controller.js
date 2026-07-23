const createCrudController = require('./crudControllerFactory');
const hrService = require('../services/hr.service');

module.exports = createCrudController(hrService);
