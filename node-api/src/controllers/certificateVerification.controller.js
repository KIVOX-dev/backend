const studentSkillService = require('../services/studentSkill.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const verify = asyncHandler(async (req, res) => {
  const certificate = await studentSkillService.verifyCertificate(req.params.id);
  ApiResponse.ok(res, certificate);
});

module.exports = { verify };
