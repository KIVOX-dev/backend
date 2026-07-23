const BaseService = require('./BaseService');
const institutionRepository = require('../repositories/institution.repository');

module.exports = new BaseService(institutionRepository, { entityName: 'Institution' });
