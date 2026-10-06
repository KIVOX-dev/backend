const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const pipeline = require('../services/hrPipeline.service');
const interviews = require('../services/hrInterview.service');
const evaluations = require('../services/hrEvaluation.service');
const matching = require('../services/hrMatching.service');
const talentPool = require('../services/hrTalentPool.service');
const analytics = require('../services/hrAnalytics.service');
const dashboard = require('../services/hrDashboard.service');
const employees = require('../services/hrEmployee.service');

const ok = (fn, message) => asyncHandler(async (req, res) => ApiResponse.ok(res, await fn(req), message));
const created = (fn) => asyncHandler(async (req, res) => ApiResponse.created(res, await fn(req)));
const paged = (fn) => asyncHandler(async (req, res) => {
  const { rows, meta } = await fn(req);
  ApiResponse.paginated(res, rows, meta);
});

module.exports = {
  // dashboard & analytics
  dashboard: ok((req) => dashboard.summary(req.user, req.query)),
  analytics: ok((req) => analytics.overview(req.user, req.query)),

  // pipeline
  listApplications: paged((req) => pipeline.listApplications(req.user, req.query)),
  board: ok((req) => pipeline.board(req.params.placementId, req.user)),
  applicationDetail: ok((req) => pipeline.detail(req.params.id, req.user)),
  moveStage: ok((req) => pipeline.moveStage(req.params.id, req.body.status, req.user, req.body), 'Stage updated'),
  bulkMove: ok((req) => pipeline.bulkMove(req.body.application_ids, req.body.status, req.user, req.body), 'Bulk stage update complete'),
  addNote: ok((req) => pipeline.addNote(req.params.id, req.body.note, req.user), 'Note saved'),

  // interviews
  scheduleInterview: created((req) => interviews.schedule(req.body, req.user)),
  listInterviews: paged((req) => interviews.list(req.user, req.query)),
  interviewCalendar: ok((req) => interviews.calendar(req.user, req.query)),
  getInterview: ok((req) => interviews.getById(req.params.id, req.user)),
  rescheduleInterview: ok((req) => interviews.reschedule(req.params.id, req.body, req.user), 'Interview updated'),
  setInterviewStatus: ok((req) => interviews.setStatus(req.params.id, req.body, req.user), 'Interview status updated'),
  submitFeedback: ok((req) => interviews.submitFeedback(req.params.id, req.body, req.user), 'Feedback saved'),
  interviewIcs: asyncHandler(async (req, res) => {
    const ics = await interviews.toIcs(req.params.id, req.user);
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="interview.ics"');
    res.send(ics);
  }),

  // evaluation
  saveEvaluation: ok((req) => evaluations.upsert(req.params.applicationId, req.body, req.user), 'Scorecard saved'),
  getEvaluations: ok((req) => evaluations.forApplication(req.params.applicationId, req.user)),
  deleteEvaluation: asyncHandler(async (req, res) => {
    await evaluations.remove(req.params.id, req.user);
    ApiResponse.ok(res, null, 'Deleted');
  }),
  ranking: ok((req) => evaluations.ranking(req.params.placementId, req.user, req.query)),

  // matching
  applicationMatch: ok((req) => matching.matchForApplication(req.params.applicationId, req.user)),
  matchApplicants: ok((req) => matching.matchApplicants(req.params.placementId, req.user)),
  recommend: ok((req) => matching.recommend(req.params.placementId, req.user, req.query)),

  // talent pool
  talentList: paged((req) => talentPool.list(req.user, req.query)),
  talentFacets: ok((req) => talentPool.facets(req.user)),
  talentSearchStudents: ok((req) => talentPool.searchStudents(req.user, req.query)),
  talentAdd: created((req) => talentPool.add(req.body, req.user)),
  talentGet: ok((req) => talentPool.get(req.params.id, req.user)),
  talentUpdate: ok((req) => talentPool.update(req.params.id, req.body, req.user), 'Updated'),
  talentRemove: asyncHandler(async (req, res) => {
    await talentPool.remove(req.params.id, req.user);
    ApiResponse.ok(res, null, 'Removed from talent pool');
  }),
  talentAssign: ok((req) => talentPool.assignToVacancy(req.params.id, req.body.placement_id, req.user, req.body), 'Candidate added to vacancy'),
  talentMatches: ok((req) => talentPool.matchesForVacancy(req.params.placementId, req.user, req.query)),

  // employees
  employeeStats: ok((req) => employees.stats(req.user)),
  employeeList: paged((req) => employees.list(req.user, req.query)),
  employeeCreate: created((req) => employees.create(req.body, req.user)),
  employeeGet: ok((req) => employees.get(req.params.id, req.user)),
  employeeUpdate: ok((req) => employees.update(req.params.id, req.body, req.user), 'Updated'),
  employeeRemove: asyncHandler(async (req, res) => {
    await employees.remove(req.params.id, req.user);
    ApiResponse.ok(res, null, 'Deleted');
  }),
  employeeFromApplication: asyncHandler(async (req, res) => {
    // Hiring *is* what creates the employee: move the application to Hired
    // (idempotent if it already is), which opens the employee record.
    const application = await pipeline.moveStage(req.params.applicationId, 'hired', req.user, { hire: req.body, note: 'Converted to employee' });
    const employee = await employees.createFromApplication(application, req.user, req.body);
    ApiResponse.created(res, employee);
  }),

  addTask: created((req) => employees.addTask(req.params.id, req.body, req.user)),
  updateTask: ok((req) => employees.updateTask(req.params.id, req.params.taskId, req.body, req.user), 'Task updated'),
  removeTask: ok((req) => employees.removeTask(req.params.id, req.params.taskId, req.user), 'Task removed'),
  applyTemplate: ok((req) => employees.applyOnboardingTemplate(req.params.id, req.user), 'Onboarding checklist updated'),

  addSkill: ok((req) => employees.addSkill(req.params.id, req.body, req.user), 'Skill saved'),
  removeSkill: ok((req) => employees.removeSkill(req.params.id, req.params.name, req.user), 'Skill removed'),
  addCertification: created((req) => employees.addCertification(req.params.id, req.body, req.user)),
  removeCertification: ok((req) => employees.removeCertification(req.params.id, req.params.certId, req.user), 'Certification removed'),

  addDocument: created((req) => {
    const file = (req.files || []).find((f) => f.fieldname === 'file');
    return employees.addDocument(req.params.id, req.body, file, req.user);
  }),
  documentUrl: ok((req) => employees.documentUrl(req.params.id, req.params.docId, req.user)),
  verifyDocument: ok((req) => employees.verifyDocument(req.params.id, req.params.docId, req.body.verified, req.user), 'Document updated'),
  removeDocument: ok((req) => employees.removeDocument(req.params.id, req.params.docId, req.user), 'Document removed'),

  addReview: created((req) => employees.addReview(req.params.id, req.body, req.user)),
  removeReview: ok((req) => employees.removeReview(req.params.id, req.params.reviewId, req.user), 'Review removed'),
  updateGoal: ok((req) => employees.updateGoal(req.params.id, req.params.reviewId, req.params.goalId, req.body, req.user), 'Goal updated'),
  performance: ok((req) => employees.performanceSummary(req.params.id, req.user)),
};
