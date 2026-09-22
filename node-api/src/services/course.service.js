const courseRepository = require('../repositories/course.repository');
const lessonRepository = require('../repositories/lesson.repository');
const lessonProgressRepository = require('../repositories/lessonProgress.repository');
const lessonNoteRepository = require('../repositories/lessonNote.repository');
const lessonAssessmentAttemptRepository = require('../repositories/lessonAssessmentAttempt.repository');
const studentSkillBadgeRepository = require('../repositories/studentSkillBadge.repository');
const studentCertificateRepository = require('../repositories/studentCertificate.repository');
const studentRepository = require('../repositories/student.repository');
const roadmapService = require('./roadmap.service');
const { parseYoutubeInput, fetchPlaylist, fetchSingleVideo, YoutubeApiError } = require('../utils/youtubeClient');
const { callAiService } = require('../utils/aiServiceClient');
const { matchSkill } = require('../config/skillCatalog');
const ApiError = require('../utils/ApiError');
const recordActivity = require('../utils/recordActivity');
const logger = require('../utils/logger');
const env = require('../config/env');

const QUESTIONS_PER_LESSON = 25;
// Flat total, not scaled per-question — matches AssessmentWindow.tsx's own
// ASSESSMENT_DURATION_SECONDS constant (kept in sync manually; this is what
// the gate screen's "Duration" row and the actual submit deadline use).
const ASSESSMENT_DURATION_SECONDS = 5 * 60;
// Matches the 60% pass mark already shown on the Assessment gate screen
// (AssessmentWindow.tsx's "Pass Marks: 60%") — a passing attempt is what
// counts toward a skill badge, not merely a completed one.
const SKILL_PASS_PERCENTAGE = 60;
// Distinct passing lessons of the same skill before it becomes a real,
// LinkedIn-addable certificate — see _awardSkillProgress below.
const BADGES_PER_CERTIFICATE = 5;

async function requireStudent(actor) {
  const student = await studentRepository.findByUserId(actor.id);
  if (!student) throw ApiError.badRequest('Set up your student profile before using this');
  return student;
}

// A 'malpractice' attempt (device_detected fired during submitLessonAssessment
// below) permanently blocks retaking that lesson's assessment — checked
// before a new attempt can even be started, not just on submit, so the
// student can't re-request a fresh question set to work around it.
async function findMalpracticeAttempt(studentId, lessonId) {
  return lessonAssessmentAttemptRepository.findOne({ student_id: studentId, lesson_id: lessonId, status: 'malpractice' });
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

    const [lessons, progressRows, latestAttempts] = await Promise.all([
      lessonRepository.findByCourseId(courseId),
      lessonProgressRepository.findByCourseForStudent(student.id, courseId),
      lessonAssessmentAttemptRepository.findLatestPerLessonForCourse(student.id, courseId),
    ]);
    const progressByLesson = new Map(progressRows.map((p) => [p.lesson_id, p]));
    const latestAttemptByLesson = new Map(latestAttempts.map((a) => [a.lesson_id, a]));

    const lessonsWithProgress = lessons.map((lesson) => {
      // Never leak assessment_questions[].correct_answer through the course
      // detail payload — the Assessment tab fetches its own, separately
      // stripped copy via getLessonAssessment() below.
      const { assessment_questions, ...lessonFields } = lesson;
      const progress = progressByLesson.get(lesson.id);
      const latestAttempt = latestAttemptByLesson.get(lesson.id);
      return {
        ...lessonFields,
        has_assessment: Array.isArray(assessment_questions) && assessment_questions.length > 0,
        status: progress?.status || 'not_started',
        watched_seconds: progress?.watched_seconds || 0,
        // 'blocked': malpractice attempt exists, cannot retake (see
        // getLessonAssessment's block check). 'completed': a clean attempt
        // exists. 'not_attempted': never taken, or never generated.
        assessment_status: latestAttempt ? (latestAttempt.status === 'malpractice' ? 'blocked' : 'completed') : 'not_attempted',
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

    if (await findMalpracticeAttempt(student.id, lessonId)) {
      throw ApiError.forbidden('This assessment was disqualified for malpractice and cannot be retaken');
    }

    let questions = lesson.assessment_questions;
    let skillName = lesson.skill_name;
    if (!Array.isArray(questions) || questions.length === 0) {
      questions = await this._generateQuestions(lesson.title);
      // Skill tagging happens right alongside question generation, from the
      // same title, once — not re-derived at submit time — see
      // config/skillCatalog.js and this lesson's own skill_name column.
      skillName = matchSkill(lesson.title);
      await lessonRepository.updateById(lessonId, { assessment_questions: questions, skill_name: skillName });
    }

    const [latestAttempt, existingBadge] = await Promise.all([
      lessonAssessmentAttemptRepository.findLatestForLesson(student.id, lessonId),
      skillName ? studentSkillBadgeRepository.findOneForSkill(student.id, skillName) : null,
    ]);

    return {
      questions: questions.map(({ question, options }) => ({ question, options })),
      latest_attempt: latestAttempt || null,
      duration_seconds: ASSESSMENT_DURATION_SECONDS,
      // Shown above the Start Assessment button so the student knows what
      // passing this actually earns before they commit to it — null when
      // the lesson's title didn't match anything in the skill catalog.
      skill_progress: skillName
        ? {
            skill_name: skillName,
            badge_count: existingBadge?.badge_count || 0,
            certificate_issued: existingBadge?.certificate_issued || false,
            badges_remaining: existingBadge?.certificate_issued ? 0 : Math.max(0, BADGES_PER_CERTIFICATE - (existingBadge?.badge_count || 0)),
          }
        : null,
    };
  }

  async _generateQuestions(title) {
    try {
      // `count` is ai-service-specific to this call — test.service.js's own
      // admin test-authoring endpoint omits it and still gets that route's
      // original fixed 10, unaffected by this.
      const result = await callAiService('/v1/assessment/generate-questions', {
        title,
        type: 'youtube_lesson',
        difficulty: 'medium',
        count: QUESTIONS_PER_LESSON,
      });
      const questions = Array.isArray(result?.questions) ? result.questions : [];
      if (questions.length > 0) return questions.slice(0, QUESTIONS_PER_LESSON);
    } catch (err) {
      logger.error('Lesson assessment generation failed, using fallback', { title, error: err.message });
    }
    return [{ question: `What is this lesson, "${title}", primarily about?`, options: ['A', 'B', 'C', 'D'], correct_answer: 'A' }];
  }

  async submitLessonAssessment(actor, courseId, lessonId, answers, violations) {
    const student = await requireStudent(actor);
    const { lesson } = await requireOwnedLesson(student.id, courseId, lessonId);

    if (await findMalpracticeAttempt(student.id, lessonId)) {
      throw ApiError.forbidden('This assessment was disqualified for malpractice and cannot be retaken');
    }

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

    const isMalpractice = Boolean(violations && violations.device_detected > 0);
    const percentage = Math.round((score / questions.length) * 100);
    const attempt = await lessonAssessmentAttemptRepository.create({
      student_id: student.id,
      course_id: courseId,
      lesson_id: lessonId,
      answers,
      score,
      max_score: questions.length,
      percentage,
      violations: violations || undefined,
      status: isMalpractice ? 'malpractice' : 'completed',
    });
    await recordActivity({
      userId: actor.id,
      action: isMalpractice ? 'course_lesson_assessment_malpractice' : 'course_lesson_assessment',
      entityType: 'lesson',
      entityId: lessonId,
    });

    const skillProgress = isMalpractice ? null : await this._awardSkillProgress(student, lesson, percentage);

    return { attempt, graded, skill_progress: skillProgress };
  }

  // Fires after a genuine (non-malpractice) passing attempt. A student
  // retaking a lesson they already passed doesn't inflate the count further
  // (lesson_ids guards that) — only a NEW lesson tagged with this skill
  // moves the count, and reaching BADGES_PER_CERTIFICATE issues one real
  // certificate (see studentSkill.service.js for how that gets shown on the
  // profile / added to LinkedIn).
  async _awardSkillProgress(student, lesson, percentage) {
    if (!lesson.skill_name || percentage < SKILL_PASS_PERCENTAGE) return null;

    let badge = await studentSkillBadgeRepository.findOneForSkill(student.id, lesson.skill_name);
    if (!badge) {
      badge = await studentSkillBadgeRepository.create({ student_id: student.id, skill_name: lesson.skill_name });
    }
    if (badge.lesson_ids.includes(lesson.id)) {
      return { skill_name: lesson.skill_name, badge_count: badge.badge_count, newly_earned: false, certificate_issued: badge.certificate_issued };
    }

    const nextLessonIds = [...badge.lesson_ids, lesson.id];
    const nextCount = badge.badge_count + 1;
    let certificateIssued = badge.certificate_issued;

    if (!certificateIssued && nextCount >= BADGES_PER_CERTIFICATE) {
      certificateIssued = true;
      await studentCertificateRepository.create({ student_id: student.id, type: 'skill', skill_name: lesson.skill_name, issued_at: new Date() });
      await recordActivity({
        userId: student.user_id,
        action: 'skill_certificate_earned',
        entityType: 'student_skill_badge',
        entityId: badge.id,
      });
      // A newly-issued skill certificate might be the last one a student's
      // chosen job role needed — check right away rather than waiting for
      // their next roadmap page view (roadmap.service.js#getRoadmap already
      // covers that path too, so this is belt-and-suspenders, not the only
      // trigger).
      await roadmapService.maybeIssueRoleCertificateForStudent(student).catch((err) => {
        logger.error('Role certificate check failed after skill certificate issuance', { studentId: student.id, error: err.message });
      });
    }

    await studentSkillBadgeRepository.updateById(badge.id, {
      lesson_ids: nextLessonIds,
      badge_count: nextCount,
      certificate_issued: certificateIssued,
    });

    return { skill_name: lesson.skill_name, badge_count: nextCount, newly_earned: true, certificate_issued: certificateIssued };
  }

  // TestHistory.tsx's "Course Assessments" section — every lesson-quiz
  // attempt across every course this student has, newest first, with course/
  // lesson titles joined in (the frontend only has ids from the attempt row
  // itself, and fetching each course/lesson individually per attempt would
  // be an N+1 query for what's otherwise one aggregate call).
  async listAssessmentHistory(actor) {
    const student = await requireStudent(actor);
    const attempts = await lessonAssessmentAttemptRepository.findAllForStudent(student.id);
    if (attempts.length === 0) return [];

    const courseIds = [...new Set(attempts.map((a) => a.course_id))];
    const lessonIds = [...new Set(attempts.map((a) => a.lesson_id))];
    const [courses, lessons] = await Promise.all([courseRepository.findByIds(courseIds), lessonRepository.findByIds(lessonIds)]);
    const courseById = new Map(courses.map((c) => [c.id, c]));
    const lessonById = new Map(lessons.map((l) => [l.id, l]));

    return attempts.map((attempt) => ({
      ...attempt,
      course_title: courseById.get(attempt.course_id)?.title || null,
      lesson_title: lessonById.get(attempt.lesson_id)?.title || null,
    }));
  }
}

module.exports = new CourseService();
