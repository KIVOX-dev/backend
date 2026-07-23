const createCrudController = require('./crudControllerFactory');
const companyService = require('../services/company.service');

module.exports = createCrudController(companyService);
