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

const nirf = asyncHandler(async (req, res) => {
  ApiResponse.ok(res, await reportService.nirf(req.user, parsed(schema.filters, req)));
});

const offerLetters = asyncHandler(async (req, res) => {
  ApiResponse.ok(res, await reportService.offerLetters(req.user, parsed(schema.filters, req)));
});

const remindOfferLetters = asyncHandler(async (req, res) => {
  const result = await reportService.remindOfferLetters(req.user, parsed(schema.filters, req));
  ApiResponse.ok(res, result, `Reminder sent to ${result.sent} student${result.sent === 1 ? '' : 's'}`);
});

const auditLog = asyncHandler(async (req, res) => {
  ApiResponse.ok(res, await reportService.auditLog(req.user, parsed(schema.auditLog, req)));
});

module.exports = { nirf, offerLetters, remindOfferLetters, auditLog };
