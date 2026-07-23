const BaseService = require('./BaseService');
const studentRepository = require('../repositories/student.repository');

module.exports = new BaseService(studentRepository, { entityName: 'Student profile' });
