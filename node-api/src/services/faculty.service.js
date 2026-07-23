const BaseService = require('./BaseService');
const facultyRepository = require('../repositories/faculty.repository');

module.exports = new BaseService(facultyRepository, { entityName: 'Faculty profile' });
