const studentRepository = require('../repositories/student.repository');
const studentSkillBadgeRepository = require('../repositories/studentSkillBadge.repository');
const studentCertificateRepository = require('../repositories/studentCertificate.repository');
const roadmapSkillCacheRepository = require('../repositories/roadmapSkillCache.repository');
const { listRoles, getRole } = require('../config/jobRoleCatalog');
const { searchVideos, YoutubeApiError } = require('../utils/youtubeClient');
const ApiError = require('../utils/ApiError');
const recordActivity = require('../utils/recordActivity');
const logger = require('../utils/logger');
const env = require('../config/env');

const BADGES_PER_CERTIFICATE = 5;
// A cached skill's videos are reused as-is until they're this old, then
// refetched on the next request past that age — bounds YouTube quota spend
// (100 units/search.list call) to roughly once per skill per month, shared
// across every role and every student, rather than once per request.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VIDEOS_PER_SKILL = 6;

async function requireStudent(actor) {
  const student = await studentRepository.findByUserId(actor.id);
  if (!student) throw ApiError.badRequest('Set up your student profile before using this');
  return student;
}

function isStale(cached) {
  if (!cached || !cached.fetched_at) return true;
  return Date.now() - new Date(cached.fetched_at).getTime() > CACHE_TTL_MS;
}

class RoadmapService {
  isConfigured() {
    return Boolean(env.youtube.apiKey);
  }

  listRoles() {
    return listRoles().map(({ id, title, description, skills }) => ({
      id,
      title,
      description,
      skill_count: skills.length,
    }));
  }

  async chooseTargetRole(actor, roleId) {
    const role = getRole(roleId);
    if (!role) throw ApiError.badRequest('Unknown job role');

    const student = await requireStudent(actor);
    return studentRepository.updateById(student.id, { target_job_role: roleId });
  }

  async getRoadmap(actor, roleId) {
    if (!this.isConfigured()) throw ApiError.serviceUnavailable('YouTube integration is not configured');
    const role = getRole(roleId);
    if (!role) throw ApiError.notFound('Job role not found');

    const student = await requireStudent(actor);

    const [steps, roleCertificate] = await Promise.all([
      Promise.all(role.skills.map((skill) => this._buildStep(student.id, skill))),
      this._maybeIssueRoleCertificate(student, role),
    ]);

    return {
      role: { id: role.id, title: role.title, description: role.description },
      steps,
      role_certificate: roleCertificate
        ? { id: roleCertificate.id, role_title: roleCertificate.role_title, issued_at: roleCertificate.issued_at }
        : null,
    };
  }

  async _buildStep(studentId, skillName) {
    const [videos, badge] = await Promise.all([
      this._videosForSkill(skillName),
      studentSkillBadgeRepository.findOneForSkill(studentId, skillName),
    ]);

    return {
      skill: skillName,
      videos,
      badge_progress: {
        skill_name: skillName,
        badge_count: badge?.badge_count || 0,
        certificate_issued: badge?.certificate_issued || false,
        badges_remaining: badge?.certificate_issued ? 0 : Math.max(0, BADGES_PER_CERTIFICATE - (badge?.badge_count || 0)),
      },
    };
  }

  async _videosForSkill(skillName) {
    const cached = await roadmapSkillCacheRepository.findBySkill(skillName);
    if (!isStale(cached)) return cached.videos;

    try {
      const videos = await searchVideos(`${skillName} tutorial for beginners`, { maxResults: VIDEOS_PER_SKILL });
      await roadmapSkillCacheRepository.upsertForSkill(skillName, videos);
      return videos;
    } catch (err) {
      // A failed live refresh shouldn't blank out a roadmap step that already
      // had cached videos from a previous successful fetch — only genuinely
      // fall through to empty when there's nothing to fall back on.
      if (cached) return cached.videos;
      if (err instanceof YoutubeApiError) {
        logger.error('Roadmap video search failed', { skillName, error: err.message });
        return [];
      }
      throw err;
    }
  }

  // Fires on every roadmap view (cheap — one role, not a catalog scan) and
  // right after a skill certificate is newly issued (see
  // course.service.js#_awardSkillProgress). Idempotent: findRoleCertificate
  // guards against issuing a second one for the same student+role.
  async _maybeIssueRoleCertificate(student, role) {
    const existing = await studentCertificateRepository.findRoleCertificate(student.id, role.id);
    if (existing) return existing;

    const badges = await studentSkillBadgeRepository.findForStudent(student.id);
    const certifiedSkills = new Set(badges.filter((b) => b.certificate_issued).map((b) => b.skill_name));
    const hasAllSkills = role.skills.every((skill) => certifiedSkills.has(skill));
    if (!hasAllSkills) return null;

    const certificate = await studentCertificateRepository.create({
      student_id: student.id,
      type: 'role',
      role_id: role.id,
      role_title: role.title,
      issued_at: new Date(),
    });
    await recordActivity({
      userId: student.user_id,
      action: 'role_certificate_earned',
      entityType: 'student_certificate',
      entityId: certificate.id,
    });
    return certificate;
  }

  // Called from course.service.js right after a skill certificate is newly
  // issued — checks only the student's own target role (if any), not every
  // role in the catalog, since that's the only one a student is actively
  // working toward.
  async maybeIssueRoleCertificateForStudent(student) {
    if (!student.target_job_role) return null;
    const role = getRole(student.target_job_role);
    if (!role) return null;
    return this._maybeIssueRoleCertificate(student, role);
  }
}

module.exports = new RoadmapService();
