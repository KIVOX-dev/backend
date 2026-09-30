const studentOutcomeService = require('../services/studentOutcome.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const proofFileOf = (req) => (req.files || []).find((f) => f.fieldname === 'proof_file');

const create = asyncHandler(async (req, res) => {
  const outcome = await studentOutcomeService.create(req.body, req.user, proofFileOf(req));
  ApiResponse.created(res, outcome);
});

const listForStudent = asyncHandler(async (req, res) => {
  ApiResponse.ok(res, await studentOutcomeService.listForStudent(req.params.studentId, req.user));
});

const getProofUrl = asyncHandler(async (req, res) => {
  ApiResponse.ok(res, await studentOutcomeService.getProofUrl(req.params.id, req.user));
});

const attachProof = asyncHandler(async (req, res) => {
  const outcome = await studentOutcomeService.attachProof(req.params.id, req.user, proofFileOf(req));
  ApiResponse.ok(res, outcome, 'Document attached');
});

const verify = asyncHandler(async (req, res) => {
  const outcome = await studentOutcomeService.verify(req.params.id, req.body.verification_status, req.user);
  ApiResponse.ok(res, outcome, 'Verification updated');
});

const remove = asyncHandler(async (req, res) => {
  await studentOutcomeService.remove(req.params.id, req.user);
  ApiResponse.ok(res, null, 'Deleted');
});

module.exports = { create, listForStudent, getProofUrl, attachProof, verify, remove };
