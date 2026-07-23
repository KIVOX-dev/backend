const BaseService = require('./BaseService');
const companyRepository = require('../repositories/company.repository');

module.exports = new BaseService(companyRepository, { entityName: 'Company' });
