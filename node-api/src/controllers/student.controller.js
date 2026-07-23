const createCrudController = require('./crudControllerFactory');
const studentService = require('../services/student.service');

module.exports = createCrudController(studentService);
