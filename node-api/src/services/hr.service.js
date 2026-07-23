const BaseService = require('./BaseService');
const hrRepository = require('../repositories/hr.repository');

module.exports = new BaseService(hrRepository, { entityName: 'HR profile' });
