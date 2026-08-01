const BaseService = require('./BaseService');
const resumeBuilderRepository = require('../repositories/resumeBuilder.repository');
const resumeVersionRepository = require('../repositories/resumeVersion.repository');
const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const { isGroqConfigured, groqComplete } = require('../utils/groqClient');
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

// python-service's get_groq_client() equivalent: every resume.py AI endpoint
// hard-fails immediately if Groq isn't configured (unlike ai.py's
// improveResumeText below, which soft-falls-back instead — see that method).
function requireGroq() {
  if (!isGroqConfigured()) throw ApiError.internal('GROQ_API_KEY is not configured');
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
    requireGroq();
    const student = await resolveStudent(actor);
    const resume = await resumeBuilderRepository.findByStudentId(student.id);
    if (!resume) throw ApiError.notFound('Active resume not found');

    // Strip fields that don't help ATS analysis, to keep the prompt small —
    // same fields python-service's analyze_resume strips.
    const { id, student_id, created_at, updated_at, sectionOrder, template, zoom, ...forAnalysis } = resume;

    const systemPrompt = 'You are an expert ATS Resume Analyzer. Return a valid JSON object only, no markdown.';
    const userPrompt = `Analyze the following resume and return a highly detailed, professional feedback report.

Required JSON keys:
- "score": integer 0-100 (ATS score)
- "readability": integer 0-100
- "section_completeness": list of {"section", "score" (0-100), "status" ("Complete"|"Needs Info"|"Missing")}
- "keywords_analyzed": integer count of key industry keywords found
- "missing_keywords": list of strings
- "formatting_issues": list of strings
- "contact_validation": list of strings
- "skills_gap": list of strings
- "experience_quality": string
- "suggestions": list of strings

Resume Data:
${JSON.stringify(forAnalysis, null, 2)}`;

    try {
      return await groqComplete({ systemPrompt, userPrompt, temperature: 0.3, maxTokens: 2048, jsonResponse: true });
    } catch (err) {
      logger.error('ATS analysis failed', { error: err.message });
      throw ApiError.internal(`ATS Analysis failed: ${err.message}`);
    }
  }

  async matchJobDescription(actor, jdText) {
    requireGroq();
    const student = await resolveStudent(actor);
    const resume = await resumeBuilderRepository.findByStudentId(student.id);
    if (!resume) throw ApiError.notFound('Active resume not found');

    const { id, student_id, ...forMatch } = resume;

    const systemPrompt = 'You are an expert recruiter. Return a valid JSON object only, no markdown.';
    const userPrompt = `Compare the candidate's resume with the provided Job Description. Return a detailed compatibility report.

Required JSON keys:
- "match_percentage": integer 0-100
- "ats_match_status": string ("Highly Compatible"|"Moderately Compatible"|"Low Compatibility")
- "matching_skills": list of strings
- "missing_keywords": list of strings
- "suggested_skills": list of strings
- "missing_experience": string
- "recommended_certifications": list of strings
- "recommended_projects": list of strings
- "overall_evaluation": string

Job Description:
${jdText}

Candidate Resume:
${JSON.stringify(forMatch, null, 2)}`;

    try {
      return await groqComplete({ systemPrompt, userPrompt, temperature: 0.3, maxTokens: 2048, jsonResponse: true });
    } catch (err) {
      logger.error('JD match failed', { error: err.message });
      throw ApiError.internal(`JD Matching failed: ${err.message}`);
    }
  }

  async aiSuggest(actor, { action, section, content, jdText }) {
    requireGroq();
    const systemPrompt = 'You are a professional ATS resume writer. Help the student optimize their profile.';
    let userPrompt;

    if (action === 'summary') {
      userPrompt = `Based on the following content, write a concise, compelling, and professional resume summary (maximum 3 sentences):\n${content}`;
    } else if (action === 'rewrite') {
      userPrompt = `Rewrite the following description or bullet point using strong action verbs, professional style, and making it ATS-friendly. Maintain all facts and metrics:\n${content}`;
    } else if (action === 'skills') {
      userPrompt = `Given the student's department or role '${content}', suggest a structured list of technical skills, tools, and soft skills they should include on their resume. Return a JSON object with keys 'technical', 'tools', 'soft'.`;
    } else if (action === 'grammar') {
      userPrompt = `Correct any grammar or spelling mistakes in the following text. Preserve the original meaning and formatting. Return only the corrected text:\n${content}`;
    } else if (action === 'cover_letter' || action === 'interview_prep') {
      const student = await resolveStudent(actor);
      const resume = await resumeBuilderRepository.findByStudentId(student.id);
      const resumeData = resume ? JSON.stringify(resume) : content;
      userPrompt =
        action === 'cover_letter'
          ? `Write a professional, tailored Cover Letter based on this Job Description and the student's resume.\n\nJob Description:\n${jdText}\n\nStudent Resume:\n${resumeData}`
          : `Generate 5 tailored technical and behavioral interview preparation questions and guidelines based on the student's resume.\n\nStudent Resume:\n${resumeData}`;
    } else {
      throw ApiError.badRequest('Invalid action type');
    }

    try {
      let output = await groqComplete({ systemPrompt, userPrompt, temperature: 0.5, maxTokens: 1500 });
      output = output.trim();

      if (action === 'skills') {
        const start = output.indexOf('{');
        const end = output.lastIndexOf('}') + 1;
        if (start !== -1 && end !== 0) {
          try {
            output = JSON.parse(output.slice(start, end));
          } catch {
            // fall through with the raw text — same best-effort behavior as python
          }
        }
      }
      return { result: output };
    } catch (err) {
      logger.error('AI suggestion failed', { action, error: err.message });
      throw ApiError.internal(`AI suggestion failed: ${err.message}`);
    }
  }

  // Note the auth requirement here — python-service's /resume/parse had NO
  // Depends(get_current_user) at all, callable by anyone. Deliberately
  // tightened in this port (see the Phase 3 migration plan): every other AI
  // endpoint requires login, and an unauthenticated LLM-calling endpoint is
  // an easy way to burn through the Groq quota with no accountability.
  async parseResumeText(text) {
    requireGroq();
    const systemPrompt = 'You are an expert resume parsing tool. Return a valid JSON object only, no markdown.';
    const userPrompt = `Extract the candidate information from the following text into structured JSON fields matching this exact key structure:

- "personal": { "name": "", "email": "", "phone": "", "linkedin": "", "github": "", "portfolio": "", "address": "", "role": "" }
- "objective": ""
- "education": [ { "institution": "", "degree": "", "year": "", "score": "" } ]
- "experience": [ { "role": "", "company": "", "duration": "", "description": "" } ]
- "projects": [ { "title": "", "description": "", "link": "", "technologies": "" } ]
- "skills": [ { "name": "", "category": "technical" | "soft" } ]
- "certifications": [ { "name": "", "issuer": "", "year": "" } ]

Text content:
${text}`;

    try {
      return await groqComplete({ systemPrompt, userPrompt, temperature: 0.1, maxTokens: 2048, jsonResponse: true });
    } catch (err) {
      logger.error('Resume parsing failed', { error: err.message });
      throw ApiError.internal(`Resume parsing failed: ${err.message}`);
    }
  }

  // Ported from python-service's ai.py#improve_resume. Distinct fallback
  // shape from every method above: a MISSING key returns the original text
  // untouched (200, not an error) — only an actual API failure once
  // configured is a hard error. resume.py's endpoints never soft-fallback;
  // this one always does for the missing-key case.
  async improveResumeText({ objective, education, skills, experience }) {
    if (!isGroqConfigured()) {
      return { objective, education, skills, experience, message: 'GROQ_API_KEY not configured. Returning original text.' };
    }

    const systemPrompt = 'You are an expert Resume Writer and Career Coach.';
    const userPrompt = `Improve the following resume sections to make them sound professional, impactful, and ATS-friendly.
Do not add new facts, just rewrite the existing information better.
Return the result as a raw JSON object with keys: "objective", "education", "skills", "experience".

Objective: ${objective}
Education: ${education}
Skills: ${skills}
Experience: ${experience}`;

    try {
      return await groqComplete({ systemPrompt, userPrompt, temperature: 0.7, maxTokens: 1024, jsonResponse: true });
    } catch (err) {
      logger.error('Resume improvement failed', { error: err.message });
      throw ApiError.internal(`Failed to improve resume: ${err.message}`);
    }
  }
}

module.exports = new ResumeBuilderService();
