const courseService = require('../services/course.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const importCourse = asyncHandler(async (req, res) => {
  const course = await courseService.import(req.user, req.body.url);
  ApiResponse.created(res, course, 'Course created');
});

const list = asyncHandler(async (req, res) => {
  const courses = await courseService.list(req.user);
  ApiResponse.ok(res, courses);
});

const getById = asyncHandler(async (req, res) => {
  const course = await courseService.getById(req.user, req.params.id);
  ApiResponse.ok(res, course);
});

const remove = asyncHandler(async (req, res) => {
  await courseService.remove(req.user, req.params.id);
  ApiResponse.ok(res, null, 'Course removed');
});

const updateLessonProgress = asyncHandler(async (req, res) => {
  const progress = await courseService.updateLessonProgress(req.user, req.params.id, req.params.lessonId, req.body);
  ApiResponse.ok(res, progress);
});

const listNotes = asyncHandler(async (req, res) => {
  const notes = await courseService.listNotes(req.user, req.params.id, req.params.lessonId);
  ApiResponse.ok(res, notes);
});

const createNote = asyncHandler(async (req, res) => {
  const note = await courseService.createNote(req.user, req.params.id, req.params.lessonId, req.body);
  ApiResponse.created(res, note);
});

const deleteNote = asyncHandler(async (req, res) => {
  await courseService.deleteNote(req.user, req.params.id, req.params.lessonId, req.params.noteId);
  ApiResponse.ok(res, null, 'Note removed');
});

const getLessonAssessment = asyncHandler(async (req, res) => {
  const assessment = await courseService.getLessonAssessment(req.user, req.params.id, req.params.lessonId);
  ApiResponse.ok(res, assessment);
});

const submitLessonAssessment = asyncHandler(async (req, res) => {
  const result = await courseService.submitLessonAssessment(req.user, req.params.id, req.params.lessonId, req.body.answers);
  ApiResponse.ok(res, result, 'Assessment submitted');
});

module.exports = {
  importCourse,
  list,
  getById,
  remove,
  updateLessonProgress,
  listNotes,
  createNote,
  deleteNote,
  getLessonAssessment,
  submitLessonAssessment,
};
