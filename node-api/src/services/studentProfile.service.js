const studentRepository = require('../repositories/student.repository');
const departmentRepository = require('../repositories/department.repository');
const institutionRepository = require('../repositories/institution.repository');
const userRepository = require('../repositories/user.repository');
const assessmentAttemptRepository = require('../repositories/assessmentAttempt.repository');
const interviewAttemptRepository = require('../repositories/interviewAttempt.repository');
const resumeBuilderRepository = require('../repositories/resumeBuilder.repository');
const testRepository = require('../repositories/test.repository');
const ApiError = require('../utils/ApiError');
const {
  verifyLeetcodeUsername,
  verifyHackerrankUsername,
  verifyDribbbleUsername,
  fetchLeetcodeStats,
  fetchHackerrankStats,
  SocialProfileNotFoundError,
} = require('../utils/socialProfileClient');

// Category -> (display label, one plausible role a strength there points
// toward). Deliberately simple/rule-based, not AI-generated — see
// PracticeModule.tsx's CATEGORIES for the same 4 categories on the
// practice-bank side.
const CATEGORY_META = {
  quantitative: { label: 'Quantitative Aptitude', role: 'Data Analyst' },
  logical: { label: 'Logical Reasoning', role: 'Software Developer' },
  verbal: { label: 'Verbal Ability', role: 'Business Analyst' },
  data_interpretation: { label: 'Data Interpretation', role: 'Business Intelligence Analyst' },
};

// Resume completeness is a plain "how many of the sections a recruiter
// actually looks for are filled in" count — no ATS scoring here (that's
// the separate, actually-AI Resume Analyzer feature); this only needs to
// answer "does this look like a usable resume yet".
const RESUME_SECTIONS = ['personal', 'objective', 'education', 'experience', 'projects', 'skills'];

function isSectionFilled(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (value && typeof value === 'object') return Object.values(value).some((v) => (typeof v === 'string' ? v.trim() : v));
  return Boolean(value);
}

function resumeCompletenessPct(resume) {
  if (!resume) return 0;
  const filled = RESUME_SECTIONS.filter((section) => isSectionFilled(resume[section])).length;
  return Math.round((filled / RESUME_SECTIONS.length) * 100);
}

function average(values) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function isSameMonth(date, reference) {
  return date.getUTCFullYear() === reference.getUTCFullYear() && date.getUTCMonth() === reference.getUTCMonth();
}

// Self-service "complete my student profile" flow — distinct from the
// existing admin-provisioned /students CRUD (which requires
// super_admin/institution_admin/faculty and creates a row on someone else's
// behalf). This is a student setting up their OWN row after signing in
// (typically via Google OAuth, before they've picked a college at all), so
// it deliberately does not go through scopeInstitution — that middleware
// would force institution_id to the caller's *current* institution, which
// is exactly what doesn't exist yet at this point.
class StudentProfileService {
  async getOwn(actor) {
    const profile = await studentRepository.findByUserId(actor.id);
    if (!profile) throw ApiError.notFound('Profile not created yet');
    return profile;
  }

  async uploadAvatar(actor, publicUrl) {
    const student = await studentRepository.findByUserId(actor.id);
    if (!student) throw ApiError.notFound('Profile not created yet');
    return studentRepository.updateById(student.id, { avatar_url: publicUrl });
  }

  async uploadCoverImage(actor, publicUrl) {
    const student = await studentRepository.findByUserId(actor.id);
    if (!student) throw ApiError.notFound('Profile not created yet');
    return studentRepository.updateById(student.id, { cover_image_url: publicUrl });
  }

  // Real stats for the Integrations tab's LeetCode card (global rank, solved
  // counts, submission calendar) — fetched on-demand rather than folded into
  // getOwn()/getSummary() above, since it's an extra outbound call to
  // LeetCode that only the Integrations screen actually needs, not every
  // profile load. Throws (doesn't swallow) on failure — unlike
  // _verifyAndNormalize's save-time check, this backs a screen the student
  // is actively looking at, where a silent stale result would be worse than
  // a visible "couldn't load your LeetCode stats" error.
  async getLeetcodeStats(actor) {
    const student = await studentRepository.findByUserId(actor.id);
    if (!student) throw ApiError.notFound('Profile not created yet');
    if (!student.leetcode_username) throw ApiError.badRequest('Connect your LeetCode account first');

    try {
      return await fetchLeetcodeStats(student.leetcode_username);
    } catch (err) {
      if (err instanceof SocialProfileNotFoundError) {
        throw ApiError.notFound(`LeetCode user "${student.leetcode_username}" not found`);
      }
      throw ApiError.serviceUnavailable("Couldn't load LeetCode stats right now — try again shortly");
    }
  }

  // Same shape as getLeetcodeStats above, for the HackerRank card — level/
  // title/followers plus real per-skill badges (name, stars earned, problems
  // solved), verified directly against real accounts before writing this.
  async getHackerrankStats(actor) {
    const student = await studentRepository.findByUserId(actor.id);
    if (!student) throw ApiError.notFound('Profile not created yet');
    if (!student.hackerrank_username) throw ApiError.badRequest('Connect your HackerRank account first');

    try {
      return await fetchHackerrankStats(student.hackerrank_username);
    } catch (err) {
      if (err instanceof SocialProfileNotFoundError) {
        throw ApiError.notFound(`HackerRank user "${student.hackerrank_username}" not found`);
      }
      throw ApiError.serviceUnavailable("Couldn't load HackerRank stats right now — try again shortly");
    }
  }

  // Backs the Performance Summary screen (ProfileSummarizer.tsx) — rule-based,
  // not an LLM: computed fresh from this student's real assessment/interview/
  // resume data on every call, so it's cheap to load and never says something
  // that isn't actually true of this student's record. `focus_areas` below is
  // what actually answers "what should I do next" — every entry names a real
  // number (a category never attempted, a category under 60%, an exact
  // missing resume section), not generic advice. See the ai-service Resume
  // Analyzer for the one place this app does call an LLM, if a real
  // generated narrative is wanted here later.
  async getSummary(actor) {
    const student = await studentRepository.findByUserId(actor.id);
    if (!student) throw ApiError.notFound('Profile not created yet');

    const [{ rows: attempts }, { rows: interviews }, resume] = await Promise.all([
      assessmentAttemptRepository.findAll({ page: 1, limit: 1000, filters: { student_id: student.id, status: 'completed' } }),
      interviewAttemptRepository.findAll({ page: 1, limit: 1000, filters: { student_id: student.id } }),
      resumeBuilderRepository.findOne({ student_id: student.id }),
    ]);

    const testIds = [...new Set(attempts.map((a) => a.test_id))];
    const tests = await testRepository.findByIds(testIds);
    const categoryByTestId = new Map(tests.map((t) => [t.id, t.category]));

    const byCategory = new Map();
    for (const attempt of attempts) {
      const category = categoryByTestId.get(attempt.test_id);
      if (!category) continue; // an assigned (non-practice-bank) test has no fixed category
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category).push(attempt);
    }

    const now = new Date();
    const lastMonthRef = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    const categoryStats = [...byCategory.entries()].map(([category, list]) => {
      const pct = Math.round(average(list.map((a) => a.percentage || 0)));
      const thisMonthAvg = average(list.filter((a) => a.completed_at && isSameMonth(new Date(a.completed_at), now)).map((a) => a.percentage || 0));
      const lastMonthAvg = average(list.filter((a) => a.completed_at && isSameMonth(new Date(a.completed_at), lastMonthRef)).map((a) => a.percentage || 0));
      const hasBothMonths = list.some((a) => a.completed_at && isSameMonth(new Date(a.completed_at), now)) &&
        list.some((a) => a.completed_at && isSameMonth(new Date(a.completed_at), lastMonthRef));
      return {
        category,
        label: CATEGORY_META[category]?.label || category,
        avg_percentage: pct,
        attempts: list.length,
        // null (not 0) when there isn't a full prior month to compare
        // against yet — the frontend shows "New" instead of a fake 0%.
        growth: hasBothMonths ? Math.round(thisMonthAvg - lastMonthAvg) : null,
      };
    }).sort((a, b) => b.avg_percentage - a.avg_percentage);

    const topSkill = categoryStats[0] || null;
    const weakness = categoryStats.length > 1 ? categoryStats[categoryStats.length - 1] : null;

    const aptitudePct = Math.round(average(attempts.map((a) => a.percentage || 0)));
    const interviewPct = Math.round(average(interviews.map((i) => (i.overall_rating || 0) * 10)));
    const resumePct = resumeCompletenessPct(resume);
    const hasData = attempts.length > 0 || interviews.length > 0 || Boolean(resume);
    // Only average in the pillars that actually have data — an unstarted
    // resume shouldn't drag down a score built entirely from real aptitude
    // attempts, and vice versa.
    const pillars = [
      attempts.length > 0 ? aptitudePct : null,
      interviews.length > 0 ? interviewPct : null,
      resume ? resumePct : null,
    ].filter((v) => v !== null);
    const overallReadiness = pillars.length ? Math.round(average(pillars)) : 0;

    const idealRole = topSkill ? CATEGORY_META[topSkill.category]?.role || null : null;

    // Concrete, specific things to do next — not just a single top/weakness
    // pick (which is null whenever category data is thin, as it is here),
    // but every category never attempted, every category scoring under 60%,
    // and the exact resume sections still missing. Each one names the real
    // number behind it so it reads as a fact about this student, not advice
    // that could apply to anyone.
    const focusAreas = [];

    const attemptedCategories = new Set(byCategory.keys());
    for (const [key, meta] of Object.entries(CATEGORY_META)) {
      if (!attemptedCategories.has(key)) {
        focusAreas.push({ severity: 'gap', text: `You haven't attempted any ${meta.label} practice tests yet — start here to build a baseline.` });
      }
    }

    for (const stat of categoryStats) {
      if (stat.avg_percentage < 60) {
        focusAreas.push({
          severity: 'weak',
          text: `${stat.label} is averaging ${stat.avg_percentage}% across ${stat.attempts} attempt${stat.attempts === 1 ? '' : 's'} — your weakest scored area, worth more practice time.`,
        });
      }
    }

    // Real completed tests exist, but every one was an assigned test
    // (no fixed category — see the loop above building byCategory), so
    // there's genuine activity with nothing to show a skill breakdown for.
    if (attempts.length > 0 && categoryStats.length === 0) {
      focusAreas.push({
        severity: 'gap',
        text: `Your ${attempts.length} completed test${attempts.length === 1 ? '' : 's'} were assigned tests with no skill category — try Mock Practice to get a real strengths/weaknesses breakdown.`,
      });
    }

    if (interviews.length === 0) {
      focusAreas.push({ severity: 'gap', text: 'No mock interviews completed yet — try one to build interview confidence and get a baseline score.' });
    } else if (interviewPct < 60) {
      focusAreas.push({
        severity: 'weak',
        text: `Mock interview average is ${(interviewPct / 10).toFixed(1)}/10 across ${interviews.length} interview${interviews.length === 1 ? '' : 's'} — the score reflects how many questions you actually answered, so answer every one fully.`,
      });
    }

    const missingSections = resume ? RESUME_SECTIONS.filter((s) => !isSectionFilled(resume[s])) : RESUME_SECTIONS;
    if (missingSections.length > 0) {
      const labels = missingSections.map((s) => s.charAt(0).toUpperCase() + s.slice(1));
      focusAreas.push({
        severity: resume ? 'weak' : 'gap',
        text: resume
          ? `Resume is missing: ${labels.join(', ')} — filling these in raises your resume completeness above ${resumePct}%.`
          : `No resume started yet — build one in Resume Builder, starting with ${labels.join(', ')}.`,
      });
    }

    const name = actor.name || 'This student';
    let executiveSummary;
    if (!hasData) {
      executiveSummary = `${name} hasn't completed any practice tests, mock interviews, or resume sections yet — complete a few to generate a real performance profile here.`;
    } else {
      const parts = [`${name} has completed ${attempts.length} practice attempt${attempts.length === 1 ? '' : 's'}`];
      if (topSkill) parts.push(`with the strongest performance in ${topSkill.label} (${topSkill.avg_percentage}% average)`);
      if (weakness) parts.push(`and room to improve in ${weakness.label} (${weakness.avg_percentage}% average)`);
      let summary = parts.join(', ') + '.';
      if (interviews.length > 0) {
        summary += ` ${interviews.length} mock interview${interviews.length === 1 ? '' : 's'} completed, averaging ${(interviewPct / 10).toFixed(1)}/10.`;
      }
      summary += ` Overall placement readiness is ${overallReadiness}/100.`;
      executiveSummary = summary;
    }

    return {
      has_data: hasData,
      executive_summary: executiveSummary,
      top_skill: topSkill?.label ?? null,
      weakness: weakness?.label ?? null,
      ideal_role: idealRole,
      overall_readiness: overallReadiness,
      aptitude_pct: aptitudePct,
      interview_pct: interviewPct,
      resume_pct: resumePct,
      category_trends: categoryStats,
      focus_areas: focusAreas,
    };
  }

  async createOwn(actor, data) {
    const existing = await studentRepository.findByUserId(actor.id);
    if (existing) throw ApiError.conflict('Profile already exists — use PUT to update it');

    await this._validateCollegeDepartment(data.collegeId, data.departmentId);
    await this._assertRollNumberAvailable(data.collegeId, data.rollNumber);

    const profile = await studentRepository.create({
      user_id: actor.id,
      institution_id: data.collegeId,
      department_id: data.departmentId,
      roll_number: data.rollNumber,
      year_of_study: data.year,
      semester: data.semester,
      section: data.section,
      phone: data.phone,
      date_of_birth: data.dateOfBirth,
      gender: data.gender,
      address: data.address,
      profile_completed: true,
    });

    // Keeps the user record's institution_id in sync, since every other
    // institution-scoped endpoint (tests, placements, achievements, ...)
    // reads it from there (and from the JWT, issued from that same field —
    // note the student's *current* access token was minted before this
    // college was chosen, so institution-scoped features won't see it until
    // they log in again or the token is refreshed).
    await userRepository.updateById(actor.id, { institution_id: data.collegeId });

    return profile;
  }

  async updateOwn(actor, data) {
    const existing = await studentRepository.findByUserId(actor.id);
    if (!existing) throw ApiError.notFound('Profile not found — create it first');

    // institution_id is locked once set by createOwn — a student can't
    // reassign themselves to a different college later just by posting a
    // different collegeId. Changing institutions is an admin-mediated
    // process, not a self-service one.
    if (data.collegeId && existing.institution_id && data.collegeId !== existing.institution_id) {
      throw ApiError.badRequest('Your college is already set and cannot be changed here — contact an administrator to transfer institutions');
    }

    const collegeId = existing.institution_id;
    const departmentId = data.departmentId || existing.department_id;
    if (data.departmentId) {
      await this._validateCollegeDepartment(collegeId, departmentId);
    }
    if (data.rollNumber && data.rollNumber !== existing.roll_number) {
      await this._assertRollNumberAvailable(collegeId, data.rollNumber, existing.id);
    }

    const payload = {};
    if (data.departmentId) payload.department_id = data.departmentId;
    if (data.rollNumber) payload.roll_number = data.rollNumber;
    if (data.year != null) payload.year_of_study = data.year;
    if (data.semester != null) payload.semester = data.semester;
    if (data.section) payload.section = data.section;
    if (data.phone) payload.phone = data.phone;
    if (data.dateOfBirth) payload.date_of_birth = data.dateOfBirth;
    if (data.gender) payload.gender = data.gender;
    if (data.address) payload.address = data.address;

    // Unlike the fields above, these three support clearing (Disconnect
    // sends ''), so each needs an explicit `!== undefined` check rather than
    // the truthy checks above — a falsy '' must still reach `payload` (as
    // null) instead of being silently skipped.
    if (data.leetcodeUsername !== undefined) {
      payload.leetcode_username = await this._verifyAndNormalize(data.leetcodeUsername, verifyLeetcodeUsername, 'LeetCode');
    }
    if (data.hackerrankUsername !== undefined) {
      payload.hackerrank_username = await this._verifyAndNormalize(data.hackerrankUsername, verifyHackerrankUsername, 'HackerRank');
    }
    if (data.dribbbleUsername !== undefined) {
      payload.dribbble_username = await this._verifyAndNormalize(data.dribbbleUsername, verifyDribbbleUsername, 'Dribbble');
    }

    return studentRepository.updateById(existing.id, payload);
  }

  // Shared by the three best-effort-verified username fields above. An
  // empty value clears the field (null); a non-empty one is checked against
  // the real site — SocialProfileNotFoundError (the site definitively said
  // "no such user") becomes a 400 the student sees; any other verification
  // failure (timeout, site outage) is already swallowed inside verifyFn
  // itself, so the username still saves.
  async _verifyAndNormalize(rawValue, verifyFn, label) {
    const value = (rawValue || '').trim();
    if (!value) return null;
    try {
      await verifyFn(value);
    } catch (err) {
      if (err instanceof SocialProfileNotFoundError) {
        throw ApiError.badRequest(`Couldn't find a ${label} user "${value}" — check the username and try again`);
      }
      throw err;
    }
    return value;
  }

  async _validateCollegeDepartment(collegeId, departmentId) {
    const college = await institutionRepository.findById(collegeId);
    if (!college) throw ApiError.badRequest('Selected college does not exist');

    const department = await departmentRepository.findById(departmentId);
    if (!department) throw ApiError.badRequest('Selected department does not exist');
    if (department.institution_id !== collegeId) {
      throw ApiError.badRequest('Selected department does not belong to the selected college');
    }
  }

  async _assertRollNumberAvailable(collegeId, rollNumber, excludeStudentId) {
    const clash = await studentRepository.findOne({ institution_id: collegeId, roll_number: rollNumber });
    if (clash && clash.id !== excludeStudentId) {
      throw ApiError.conflict('This roll number is already in use at the selected college');
    }
  }
}

module.exports = new StudentProfileService();
