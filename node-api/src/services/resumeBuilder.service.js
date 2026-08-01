const BaseService = require('./BaseService');
const resumeBuilderRepository = require('../repositories/resumeBuilder.repository');
const resumeVersionRepository = require('../repositories/resumeVersion.repository');
const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const { callAiService, AiServiceUnavailableError, AiServiceUpstreamError } = require('../utils/aiServiceClient');
const { buildInstitutionFilter } = require('../utils/authz');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const RESUME_SECTION_FIELDS = [
  'personal', 'objective', 'education', 'experience', 'projects', 'skills',
  'certifications', 'internships', 'achievements', 'hackathons', 'publications',
  'languages', 'volunteer', 'references', 'customSections', 'sectionOrder', 'template', 'zoom',
];

function defaultResume(user) {
  return {
    personal: {
      name: user.full_name, email: user.email, phone: '', linkedin: '', github: '',
      portfolio: '', address: '', role: '',
    },
    objective: '',
    education: [], experience: [], projects: [], skills: [], certifications: [],
    internships: [], achievements: [], hackathons: [], publications: [], languages: [],
    volunteer: [], references: [], customSections: [],
    sectionOrder: ['personal', 'objective', 'education', 'experience', 'projects', 'skills', 'certifications'],
    template: 'modern',
  };
}

// Maps an AI-service failure onto the same error contract these methods
// already had before AI features moved out of node-api — the frontend
// never needs to change to handle this. AiServiceUpstreamError(503, '...not
// configured') becomes the exact ApiError.internal('GROQ_API_KEY is not
// configured') these methods always threw when Groq wasn't configured;
// anything else the AI service returns (502 upstream failure, 400 bad
// input) is forwarded with its own status and message; total unreachability
// becomes a 503 the frontend's existing generic error/toast handling
// already covers with no changes needed there either.
function translateAiServiceError(err, fallbackMessage) {
  if (err instanceof AiServiceUnavailableError) {
    return ApiError.serviceUnavailable('AI service is currently unavailable');
  }
  if (err instanceof AiServiceUpstreamError) {
    if (err.statusCode === 503) return ApiError.internal(err.detail || 'GROQ_API_KEY is not configured');
    if (err.statusCode === 400) return ApiError.badRequest(err.detail || 'Invalid request');
    return ApiError.internal(err.detail || fallbackMessage);
  }
  return err;
}

async function resolveStudent(actor) {
  const student = await studentRepository.findByUserId(actor.id);
  if (!student) throw ApiError.badRequest('No student profile is linked to this account');
  return student;
}

class ResumeBuilderService extends BaseService {
  constructor() {
    super(resumeBuilderRepository, { entityName: 'Resume' });
  }

  // Staff-facing listing (GET /resume/all, /resume/all/:id) — students never
  // hit this path (they use getOwn below), so no row-level check is needed
  // beyond the institution scope.
  async list(queryParams, actor) {
    return super.list(queryParams, buildInstitutionFilter(actor));
  }

  // Auto-creates a default resume on first access — ported from
  // python-service's GET /resume, which does the same (node-api's version of
  // this used to 404 instead; changed to match the behavior the live
  // frontend actually depends on).
  async getOwn(actor) {
    const student = await resolveStudent(actor);
    let resume = await resumeBuilderRepository.findByStudentId(student.id);
    if (!resume) {
      const user = await userRepository.findById(actor.id);
      resume = await resumeBuilderRepository.create({
        student_id: student.id,
        institution_id: student.institution_id,
        ...defaultResume(user),
      });
    }
    const versions = await resumeVersionRepository.findByStudentId(student.id);
    return { resume, versions };
  }

  // Auto-save — full replace of every section field, upserted by student.
  async upsertOwn(actor, data) {
    const student = await resolveStudent(actor);
    const payload = {};
    for (const field of RESUME_SECTION_FIELDS) {
      if (data[field] !== undefined) payload[field] = data[field];
    }

    const existing = await resumeBuilderRepository.findByStudentId(student.id);
    const resume = existing
      ? await resumeBuilderRepository.updateById(existing.id, payload)
      : await resumeBuilderRepository.create({ student_id: student.id, institution_id: student.institution_id, ...payload });

    return { updated_at: resume.updated_at };
  }

  async addVersion(actor, name) {
    const student = await resolveStudent(actor);
    const resume = await resumeBuilderRepository.findByStudentId(student.id);
    if (!resume) throw ApiError.notFound('No active resume found to version');

    const snapshot = {};
    for (const field of RESUME_SECTION_FIELDS) snapshot[field] = resume[field];
    const version = await resumeVersionRepository.create({ student_id: student.id, name, ...snapshot });
    return version;
  }

  async restoreVersion(actor, versionId) {
    const student = await resolveStudent(actor);
    const version = await resumeVersionRepository.findById(versionId);
    if (!version || version.student_id !== student.id) throw ApiError.notFound('Version not found');

    const snapshot = {};
    for (const field of RESUME_SECTION_FIELDS) snapshot[field] = version[field];

    const existing = await resumeBuilderRepository.findByStudentId(student.id);
    const resume = existing
      ? await resumeBuilderRepository.updateById(existing.id, snapshot)
      : await resumeBuilderRepository.create({ student_id: student.id, institution_id: student.institution_id, ...snapshot });
    return resume;
  }

  async deleteVersion(actor, versionId) {
    const student = await resolveStudent(actor);
    const version = await resumeVersionRepository.findById(versionId);
    if (!version || version.student_id !== student.id) throw ApiError.notFound('Version not found');

    await resumeVersionRepository.deleteById(versionId);
    return null;
  }

  async analyze(actor) {
    const student = await resolveStudent(actor);
    const resume = await resumeBuilderRepository.findByStudentId(student.id);
    if (!resume) throw ApiError.notFound('Active resume not found');

    // Strip fields that don't help ATS analysis, to keep the prompt small —
    // same fields python-service's analyze_resume strips.
    const { id, student_id, created_at, updated_at, sectionOrder, template, zoom, ...forAnalysis } = resume;

    try {
      return await callAiService('/v1/resume/analyze', { resume: forAnalysis });
    } catch (err) {
      logger.error('ATS analysis failed', { error: err.message });
      throw translateAiServiceError(err, 'ATS Analysis failed');
    }
  }

  async matchJobDescription(actor, jdText) {
    const student = await resolveStudent(actor);
    const resume = await resumeBuilderRepository.findByStudentId(student.id);
    if (!resume) throw ApiError.notFound('Active resume not found');

    const { id, student_id, ...forMatch } = resume;

    try {
      return await callAiService('/v1/resume/match-jd', { resume: forMatch, jd_text: jdText });
    } catch (err) {
      logger.error('JD match failed', { error: err.message });
      throw translateAiServiceError(err, 'JD Matching failed');
    }
  }

  async aiSuggest(actor, { action, section, content, jd_text: jdText }) {
    let resume;
    if (action === 'cover_letter' || action === 'interview_prep') {
      const student = await resolveStudent(actor);
      resume = await resumeBuilderRepository.findByStudentId(student.id);
    }

    try {
      return await callAiService('/v1/resume/suggest', { action, section, content, jd_text: jdText, resume });
    } catch (err) {
      logger.error('AI suggestion failed', { action, error: err.message });
      throw translateAiServiceError(err, 'AI suggestion failed');
    }
  }

  // Note the auth requirement here — python-service's /resume/parse had NO
  // Depends(get_current_user) at all, callable by anyone. Deliberately
  // tightened in this port (see the Phase 3 migration plan): every other AI
  // endpoint requires login, and an unauthenticated LLM-calling endpoint is
  // an easy way to burn through the Groq quota with no accountability.
  async parseResumeText(text) {
    try {
      return await callAiService('/v1/resume/parse', { text });
    } catch (err) {
      logger.error('Resume parsing failed', { error: err.message });
      throw translateAiServiceError(err, 'Resume parsing failed');
    }
  }

  // Distinct fallback shape from every method above: a MISSING key returns
  // the original text untouched (200, not an error — the AI service itself
  // handles that case and returns it as a normal 200). Only a genuine
  // failure — the AI service unreachable, or Groq itself erroring once
  // configured — is still a hard error here, matching this method's
  // original behavior before AI features moved out of node-api.
  async improveResumeText({ objective, education, skills, experience }) {
    try {
      return await callAiService('/v1/resume/improve', { objective, education, skills, experience });
    } catch (err) {
      logger.error('Resume improvement failed', { error: err.message });
      throw translateAiServiceError(err, 'Failed to improve resume');
    }
  }
}

module.exports = new ResumeBuilderService();
