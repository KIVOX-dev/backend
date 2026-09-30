const reportService = require('../services/report.service');
const schema = require('../validations/report.validation');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

// The validate middleware has already rejected bad input by the time a
// handler runs, but the typed/defaulted copy it produces doesn't survive on
// req.query here — `year` would stay the string "2026" and `limit` would be
// undefined. Parsing again in the handler is what hands the service real
// numbers.
const parsed = (joiSchema, req) => joiSchema.validate(req.query, { stripUnknown: true }).value;

// One handler per report that just runs a service method on the filters.
const report = (method) =>
  asyncHandler(async (req, res) => {
    ApiResponse.ok(res, await reportService[method](req.user, parsed(schema.filters, req)));
  });

const nirf = report('nirf');
const nba = report('nba');
const naac = report('naac');
const higherStudies = report('higherStudies');
const competitiveExams = report('competitiveExams');
const offerLetters = report('offerLetters');
const studentOptions = report('studentOptions');

const remindOfferLetters = asyncHandler(async (req, res) => {
  const result = await reportService.remindOfferLetters(req.user, parsed(schema.filters, req));
  ApiResponse.ok(res, result, `Reminder sent to ${result.sent} student${result.sent === 1 ? '' : 's'}`);
});

const auditLog = asyncHandler(async (req, res) => {
  ApiResponse.ok(res, await reportService.auditLog(req.user, parsed(schema.auditLog, req)));
});

module.exports = { nirf, nba, naac, higherStudies, competitiveExams, offerLetters, studentOptions, remindOfferLetters, auditLog };
