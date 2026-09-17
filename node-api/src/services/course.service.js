const courseRepository = require('../repositories/course.repository');
const lessonRepository = require('../repositories/lesson.repository');
const lessonProgressRepository = require('../repositories/lessonProgress.repository');
const lessonNoteRepository = require('../repositories/lessonNote.repository');
const lessonAssessmentAttemptRepository = require('../repositories/lessonAssessmentAttempt.repository');
const studentRepository = require('../repositories/student.repository');
const { parseYoutubeInput, fetchPlaylist, fetchSingleVideo, YoutubeApiError } = require('../utils/youtubeClient');
const { callAiService } = require('../utils/aiServiceClient');
const ApiError = require('../utils/ApiError');
const recordActivity = require('../utils/recordActivity');
const logger = require('../utils/logger');
const env = require('../config/env');

const QUESTIONS_PER_LESSON = 10;

async function requireStudent(actor) {
  const student = await studentRepository.findByUserId(actor.id);
  if (!student) throw ApiError.badRequest('Set up your student profile before using this');
  return student;
}

// Every course/lesson-scoped endpoint needs both: the course must belong to
// this student (never another student's, regardless of how the id was
// obtained), and the lesson must actually belong to that course (guards
// against a lessonId from one course being replayed against a different
// course's :id in the URL).
async function requireOwnedLesson(studentId, courseId, lessonId) {
  const course = await courseRepository.findById(courseId);
  if (!course || course.student_id !== studentId) throw ApiError.notFound('Course not found');
  const lesson = await lessonRepository.findById(lessonId);
  if (!lesson || lesson.course_id !== courseId) throw ApiError.notFound('Lesson not found');
  return { course, lesson };
}

class CourseService {
  isConfigured() {
    return Boolean(env.youtube.apiKey);
  }

  async import(actor, url) {
    if (!this.isConfigured()) throw ApiError.serviceUnavailable('YouTube integration is not configured');
    const student = await requireStudent(actor);

    let parsed;
    try {
      parsed = parseYoutubeInput(url);
    } catch (err) {
      throw ApiError.badRequest(err.message);
    }

    let title;
    let thumbnailUrl;
    let videos;
    let playlistId = null;
    try {
      if (parsed.type === 'playlist') {
        const playlist = await fetchPlaylist(parsed.id);
        title = playlist.title;
        thumbnailUrl = playlist.thumbnailUrl;
        videos = playlist.videos;
        playlistId = parsed.id;
      } else {
        const video = await fetchSingleVideo(parsed.id);
        title = video.title;
        thumbnailUrl = video.thumbnailUrl;
        videos = [video];
      }
    } catch (err) {
      if (err instanceof YoutubeApiError) throw ApiError.badRequest(err.message);
      throw err;
    }
    if (videos.length === 0) throw ApiError.badRequest('That playlist has no watchable videos');

    const totalDurationSeconds = videos.reduce((sum, v) => sum + v.durationSeconds, 0);
    const course = await courseRepository.create({
      student_id: student.id,
      title,
      thumbnail_url: thumbnailUrl,
      source_type: parsed.type,
      source_url: url,
      youtube_playlist_id: playlistId,
      lesson_count: videos.length,
      total_duration_seconds: totalDurationSeconds,
    });

    await Promise.all(
      videos.map((video, index) =>
        lessonRepository.create({
          course_id: course.id,
          youtube_video_id: video.youtubeVideoId,
          title: video.title,
          thumbnail_url: video.thumbnailUrl,
          duration_seconds: video.durationSeconds,
          position: index,
        })
      )
    );

    await recordActivity({ userId: actor.id, action: 'course_import', entityType: 'course', entityId: course.id });
    return this.getById(actor, course.id);
  }

  async list(actor) {
    const student = await requireStudent(actor);
    const courses = await courseRepository.findForStudent(student.id);
    return Promise.all(
      courses.map(async (course) => {
        const progressRows = await lessonProgressRepository.findByCourseForStudent(student.id, course.id);
        const completedCount = progressRows.filter((p) => p.status === 'completed').length;
        return {
          ...course,
          completed_lesson_count: completedCount,
          progress_percentage: course.lesson_count > 0 ? Math.round((completedCount / course.lesson_count) * 100) : 0,
        };
      })
    );
  }

  async getById(actor, courseId) {
    const student = await requireStudent(actor);
    const course = await courseRepository.findById(courseId);
    if (!course || course.student_id !== student.id) throw ApiError.notFound('Course not found');

    const [lessons, progressRows] = await Promise.all([
      lessonRepository.findByCourseId(courseId),
      lessonProgressRepository.findByCourseForStudent(student.id, courseId),
    ]);
    const progressByLesson = new Map(progressRows.map((p) => [p.lesson_id, p]));

    const lessonsWithProgress = lessons.map((lesson) => {
      // Never leak assessment_questions[].correct_answer through the course
      // detail payload — the Assessment tab fetches its own, separately
      // stripped copy via getLessonAssessment() below.
      const { assessment_questions, ...lessonFields } = lesson;
      const progress = progressByLesson.get(lesson.id);
      return {
        ...lessonFields,
        has_assessment: Array.isArray(assessment_questions) && assessment_questions.length > 0,
        status: progress?.status || 'not_started',
        watched_seconds: progress?.watched_seconds || 0,
      };
    });
    const completedCount = lessonsWithProgress.filter((l) => l.status === 'completed').length;

    return {
      ...course,
      completed_lesson_count: completedCount,
      progress_percentage: course.lesson_count > 0 ? Math.round((completedCount / course.lesson_count) * 100) : 0,
      lessons: lessonsWithProgress,
    };
  }

  async remove(actor, courseId) {
    const student = await requireStudent(actor);
    const course = await courseRepository.findById(courseId);
    if (!course || course.student_id !== student.id) throw ApiError.notFound('Course not found');

    await Promise.all([
      lessonRepository.deleteByCourseId(courseId),
      lessonProgressRepository.deleteByCourseId(courseId),
      lessonNoteRepository.deleteByCourseId(courseId),
      lessonAssessmentAttemptRepository.deleteByCourseId(courseId),
    ]);
    await courseRepository.deleteById(courseId);
  }

  async updateLessonProgress(actor, courseId, lessonId, { status, watchedSeconds }) {
    const student = await requireStudent(actor);
    await requireOwnedLesson(student.id, courseId, lessonId);

    const existing = await lessonProgressRepository.findOneForLesson(student.id, lessonId);
    const payload = {};
    if (status) payload.status = status;
    if (typeof watchedSeconds === 'number') payload.watched_seconds = Math.max(0, Math.round(watchedSeconds));
    if (status === 'completed') payload.completed_at = new Date();
    if (status && status !== 'completed') payload.completed_at = null;

    const saved = existing
      ? await lessonProgressRepository.updateById(existing.id, payload)
      : await lessonProgressRepository.create({ student_id: student.id, course_id: courseId, lesson_id: lessonId, ...payload });

    if (status === 'completed') {
      await recordActivity({ userId: actor.id, action: 'course_lesson_complete', entityType: 'lesson', entityId: lessonId });
    }
    return saved;
  }

  async listNotes(actor, courseId, lessonId) {
    const student = await requireStudent(actor);
    await requireOwnedLesson(student.id, courseId, lessonId);
    return lessonNoteRepository.findByLessonForStudent(student.id, lessonId);
  }

  async createNote(actor, courseId, lessonId, { timestampSeconds, text }) {
    const student = await requireStudent(actor);
    await requireOwnedLesson(student.id, courseId, lessonId);
    return lessonNoteRepository.create({
      student_id: student.id,
      course_id: courseId,
      lesson_id: lessonId,
      timestamp_seconds: Math.max(0, Math.round(timestampSeconds || 0)),
      text,
    });
  }

  async deleteNote(actor, courseId, lessonId, noteId) {
    const student = await requireStudent(actor);
    await requireOwnedLesson(student.id, courseId, lessonId);
    const note = await lessonNoteRepository.findById(noteId);
    if (!note || note.student_id !== student.id || note.lesson_id !== lessonId) {
      throw ApiError.notFound('Note not found');
    }
    await lessonNoteRepository.deleteById(noteId);
  }

  // Generated once per lesson (from its title alone — see the module doc
  // comment in course.routes.js for why: YouTube's Data API only grants
  // caption/transcript access to a video's own channel owner, not to
  // arbitrary third-party viewers, so a real "quiz from what was actually
  // said" isn't available without scraping an unofficial endpoint), then
  // cached on the lesson so every student sees the same quiz and it isn't
  // re-generated (and re-billed) on every visit.
  async getLessonAssessment(actor, courseId, lessonId) {
    const student = await requireStudent(actor);
    const { lesson } = await requireOwnedLesson(student.id, courseId, lessonId);

    let questions = lesson.assessment_questions;
    if (!Array.isArray(questions) || questions.length === 0) {
      questions = await this._generateQuestions(lesson.title);
      await lessonRepository.updateById(lessonId, { assessment_questions: questions });
    }

    const latestAttempt = await lessonAssessmentAttemptRepository.findLatestForLesson(student.id, lessonId);
    return {
      questions: questions.map(({ question, options }) => ({ question, options })),
      latest_attempt: latestAttempt || null,
    };
  }

  async _generateQuestions(title) {
    try {
      const result = await callAiService('/v1/assessment/generate-questions', {
        title,
        type: 'youtube_lesson',
        difficulty: 'medium',
      });
      const questions = Array.isArray(result?.questions) ? result.questions : [];
      if (questions.length > 0) return questions.slice(0, QUESTIONS_PER_LESSON);
    } catch (err) {
      logger.error('Lesson assessment generation failed, using fallback', { title, error: err.message });
    }
    return [{ question: `What is this lesson, "${title}", primarily about?`, options: ['A', 'B', 'C', 'D'], correct_answer: 'A' }];
  }

  async submitLessonAssessment(actor, courseId, lessonId, answers) {
    const student = await requireStudent(actor);
    const { lesson } = await requireOwnedLesson(student.id, courseId, lessonId);

    const questions = Array.isArray(lesson.assessment_questions) ? lesson.assessment_questions : [];
    if (questions.length === 0) throw ApiError.badRequest('No assessment has been generated for this lesson yet');
    if (!Array.isArray(answers) || answers.length !== questions.length) {
      throw ApiError.badRequest(`Expected ${questions.length} answers`);
    }

    let score = 0;
    const graded = questions.map((q, i) => {
      const selected = answers[i];
      const isCorrect = typeof selected === 'string' && selected === q.correct_answer;
      if (isCorrect) score += 1;
      return { question: q.question, options: q.options, correct_answer: q.correct_answer, selected: selected ?? null, is_correct: isCorrect };
    });

    const attempt = await lessonAssessmentAttemptRepository.create({
      student_id: student.id,
      course_id: courseId,
      lesson_id: lessonId,
      answers,
      score,
      max_score: questions.length,
      percentage: Math.round((score / questions.length) * 100),
    });
    await recordActivity({ userId: actor.id, action: 'course_lesson_assessment', entityType: 'lesson', entityId: lessonId });

    return { attempt, graded };
  }
}

module.exports = new CourseService();
