const express = require('express');
const controller = require('../controllers/course.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const { aiLimiter } = require('../middlewares/rateLimiter');
const schema = require('../validations/course.validation');
const { ROLES } = require('../config/constants');

// "YouTube to Course" (Tools > YouTube to Course) and "Learnings" — a
// student's own imported YouTube videos/playlists, turned into trackable
// courses. Self-service like /students/profile: no scopeInstitution, every
// row is scoped to the authenticated student alone (see
// course.service.js#requireStudent/requireOwnedLesson).
//
// Note on the Assessment tab: YouTube's Data API only grants
// captions/transcript access to a video's own channel owner (OAuth-gated),
// not to arbitrary third-party viewers — there's no official way for this
// app to read what was actually said in someone else's video. Quizzes are
// generated from the lesson title alone via the existing AI question-gen
// service (course.service.js#_generateQuestions), same as the rest of the
// app's assessment features — not a transcript-grounded quiz.
const router = express.Router();
router.use(authenticate, authorize(ROLES.STUDENT));

router.post('/import', aiLimiter, validate(schema.importCourse), controller.importCourse);
router.get('/', controller.list);
router.get('/:id', controller.getById);
router.delete('/:id', controller.remove);

router.put('/:id/lessons/:lessonId/progress', validate(schema.updateProgress), controller.updateLessonProgress);

router.get('/:id/lessons/:lessonId/notes', controller.listNotes);
router.post('/:id/lessons/:lessonId/notes', validate(schema.createNote), controller.createNote);
router.delete('/:id/lessons/:lessonId/notes/:noteId', controller.deleteNote);

router.get('/:id/lessons/:lessonId/assessment', aiLimiter, controller.getLessonAssessment);
router.post('/:id/lessons/:lessonId/assessment/submit', validate(schema.submitAssessment), controller.submitLessonAssessment);

module.exports = router;
