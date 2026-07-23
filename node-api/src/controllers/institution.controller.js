const createCrudController = require('./crudControllerFactory');
const institutionService = require('../services/institution.service');

module.exports = createCrudController(institutionService);
