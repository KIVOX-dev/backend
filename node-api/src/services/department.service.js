const BaseService = require('./BaseService');
const departmentRepository = require('../repositories/department.repository');

module.exports = new BaseService(departmentRepository, { entityName: 'Department' });
