const studentSkillBadgeRepository = require('../repositories/studentSkillBadge.repository');
const studentCertificateRepository = require('../repositories/studentCertificate.repository');
const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

const BADGES_PER_CERTIFICATE = 5;

async function requireStudent(actor) {
  const student = await studentRepository.findByUserId(actor.id);
  if (!student) throw ApiError.badRequest('Set up your student profile before using this');
  return student;
}

// The public verification page this certificate's "Show credential" link on
// LinkedIn (and the card on the student's own Profile) points at — a real
// page anyone with the link can load, not a dead-end URL. See
// certificateVerification.routes.js's GET /certificates/:id/verify.
function certUrl(certificateId) {
  return `${env.frontendUrl}/verify/${certificateId}`;
}

// LinkedIn's own documented "Add to Profile" deep link for a certification
// (https://addtoprofile.linkedin.com/, ADD_TO_PROFILE / CERTIFICATION_NAME
// task) — clicking it opens LinkedIn's own "Add certification" form
// pre-filled with these fields, not a TalentSnaps-hosted form pretending to
// be LinkedIn. organizationName (not organizationId) since TalentSnaps has
// no LinkedIn Company Page id to link to yet.
function linkedinAddUrl(certificate) {
  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: `${certificate.skill_name} — TalentSnaps Certified`,
    organizationName: 'TalentSnaps',
    issueYear: String(new Date(certificate.issued_at).getFullYear()),
    issueMonth: String(new Date(certificate.issued_at).getMonth() + 1),
    certUrl: certUrl(certificate.id),
    certId: certificate.id,
  });
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}

class StudentSkillService {
  async listBadges(actor) {
    const student = await requireStudent(actor);
    const badges = await studentSkillBadgeRepository.findForStudent(student.id);
    return badges.map((badge) => ({
      skill_name: badge.skill_name,
      badge_count: badge.badge_count,
      certificate_issued: badge.certificate_issued,
      badges_remaining: badge.certificate_issued ? 0 : Math.max(0, BADGES_PER_CERTIFICATE - badge.badge_count),
    }));
  }

  async listCertificates(actor) {
    const student = await requireStudent(actor);
    const certificates = await studentCertificateRepository.findForStudent(student.id);
    return certificates.map((certificate) => ({
      id: certificate.id,
      skill_name: certificate.skill_name,
      issued_at: certificate.issued_at,
      verify_url: certUrl(certificate.id),
      linkedin_add_url: linkedinAddUrl(certificate),
    }));
  }

  // Unauthenticated on purpose — this is what a recruiter (or anyone else)
  // following the certificate's LinkedIn "Show credential" link, or the
  // verify_url shown on the student's own profile, actually lands on.
  async verifyCertificate(certificateId) {
    const certificate = await studentCertificateRepository.findById(certificateId);
    if (!certificate) throw ApiError.notFound('Certificate not found');
    const student = await studentRepository.findById(certificate.student_id);
    const user = student ? await userRepository.findById(student.user_id) : null;
    return {
      id: certificate.id,
      skill_name: certificate.skill_name,
      issued_at: certificate.issued_at,
      student_name: user?.full_name || 'A TalentSnaps student',
    };
  }
}

module.exports = new StudentSkillService();
