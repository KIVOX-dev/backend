const express = require('express');
const c = require('../controllers/hrPortal.controller');
const validate = require('../middlewares/validate');
const { documentUpload, verifyDocument } = require('../middlewares/upload');
const v = require('../validations/hrPortal.validation');

// HR portal feature routes, mounted under /api/v1/hr by hr.routes.js (which has
// already applied authenticate + the HR/super_admin guard for these prefixes).
// Every static segment is registered before any `/:id` route so it can't be
// swallowed as an id.
const router = express.Router();

// ---- dashboard & analytics ----
router.get('/dashboard', c.dashboard);
router.get('/analytics', c.analytics);

// ---- candidate pipeline ----
router.get('/applications', c.listApplications);
router.post('/applications/bulk-stage', validate(v.bulkMove), c.bulkMove);
router.get('/applications/:id', c.applicationDetail);
router.patch('/applications/:id/stage', validate(v.moveStage), c.moveStage);
router.post('/applications/:id/notes', validate(v.note), c.addNote);
router.get('/pipeline/:placementId', c.board);

// ---- interview management ----
router.get('/interviews/calendar', c.interviewCalendar);
router.get('/interviews', c.listInterviews);
router.post('/interviews', validate(v.scheduleInterview), c.scheduleInterview);
router.get('/interviews/:id', c.getInterview);
router.get('/interviews/:id/ics', c.interviewIcs);
router.patch('/interviews/:id', validate(v.rescheduleInterview), c.rescheduleInterview);
router.patch('/interviews/:id/status', validate(v.interviewStatus), c.setInterviewStatus);
router.post('/interviews/:id/feedback', validate(v.interviewFeedback), c.submitFeedback);

// ---- candidate evaluation ----
router.get('/evaluations/vacancy/:placementId/ranking', c.ranking);
router.get('/evaluations/application/:applicationId', c.getEvaluations);
router.put('/evaluations/application/:applicationId', validate(v.evaluation), c.saveEvaluation);
router.delete('/evaluations/:id', c.deleteEvaluation);

// ---- AI candidate matching ----
router.get('/matching/application/:applicationId', c.applicationMatch);
router.get('/matching/vacancy/:placementId/applicants', c.matchApplicants);
router.get('/matching/vacancy/:placementId/recommended', c.recommend);

// ---- talent pool ----
router.get('/talent-pool/facets', c.talentFacets);
router.get('/talent-pool/search-students', c.talentSearchStudents);
router.get('/talent-pool/vacancy/:placementId/matches', c.talentMatches);
router.get('/talent-pool', c.talentList);
router.post('/talent-pool', validate(v.talentAdd), c.talentAdd);
router.get('/talent-pool/:id', c.talentGet);
router.patch('/talent-pool/:id', validate(v.talentUpdate), c.talentUpdate);
router.delete('/talent-pool/:id', c.talentRemove);
router.post('/talent-pool/:id/assign', validate(v.talentAssign), c.talentAssign);

// ---- employees: profiles, onboarding, skills, documents, performance ----
router.get('/employees/stats', c.employeeStats);
router.post('/employees/from-application/:applicationId', validate(v.hire), c.employeeFromApplication);
router.get('/employees', c.employeeList);
router.post('/employees', validate(v.employeeCreate), c.employeeCreate);
router.get('/employees/:id', c.employeeGet);
router.patch('/employees/:id', validate(v.employeeUpdate), c.employeeUpdate);
router.delete('/employees/:id', c.employeeRemove);

router.post('/employees/:id/onboarding/tasks', validate(v.task), c.addTask);
router.post('/employees/:id/onboarding/apply-template', c.applyTemplate);
router.patch('/employees/:id/onboarding/tasks/:taskId', validate(v.taskUpdate), c.updateTask);
router.delete('/employees/:id/onboarding/tasks/:taskId', c.removeTask);

router.put('/employees/:id/skills', validate(v.skill), c.addSkill);
router.delete('/employees/:id/skills/:name', c.removeSkill);
router.post('/employees/:id/certifications', validate(v.certification), c.addCertification);
router.delete('/employees/:id/certifications/:certId', c.removeCertification);

// documentUpload.any() + verifyDocument: same two-layer (type + magic bytes) check as placement proofs.
router.post('/employees/:id/documents', documentUpload.any(), verifyDocument, validate(v.documentMeta), c.addDocument);
router.get('/employees/:id/documents/:docId/url', c.documentUrl);
router.patch('/employees/:id/documents/:docId', validate(v.documentVerify), c.verifyDocument);
router.delete('/employees/:id/documents/:docId', c.removeDocument);

router.get('/employees/:id/performance', c.performance);
router.post('/employees/:id/performance/reviews', validate(v.review), c.addReview);
router.delete('/employees/:id/performance/reviews/:reviewId', c.removeReview);
router.patch('/employees/:id/performance/reviews/:reviewId/goals/:goalId', validate(v.goalUpdate), c.updateGoal);

module.exports = router;
