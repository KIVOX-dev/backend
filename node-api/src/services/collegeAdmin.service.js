const BaseService = require('./BaseService');
const collegeAdminRepository = require('../repositories/collegeAdmin.repository');

module.exports = new BaseService(collegeAdminRepository, { entityName: 'College admin' });
