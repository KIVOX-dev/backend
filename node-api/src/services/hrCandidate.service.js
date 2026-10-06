const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const institutionRepository = require('../repositories/institution.repository');
const resumeBuilderRepository = require('../repositories/resumeBuilder.repository');
const studentSkillBadgeRepository = require('../repositories/studentSkillBadge.repository');
const { toSkillNames, uniqueSkills, experienceMonths, resumeToText } = require('../utils/candidateMatching');

// Shared candidate lookups for the HR module. Everything is batched ($in) so a
// page of 100 applicants costs a handful of queries, not hundreds.

const unique = (ids) => [...new Set(ids.filter(Boolean))];

async function findMany(repository, field, ids) {
  const list = unique(ids);
  if (list.length === 0) return [];
  const docs = await repository.collection.find({ [field]: { $in: list } }).toArray();
  return docs.map((d) => repository._toEntity(d));
}

// Identity + academics for a set of students. `includeContact` is false for
// candidates a recruiter has no relationship with yet (recommendations), so
// email/phone aren't handed out before the student has applied or been saved.
async function summaries(studentIds, { includeContact = true } = {}) {
  const students = await studentRepository.findByIds(unique(studentIds));
  const users = await userRepository.findByIds(unique(students.map((s) => s.user_id)));
  const institutions = await institutionRepository.findByIds(unique(students.map((s) => s.institution_id)));
  const userById = new Map(users.map((u) => [u.id, u]));
  const instById = new Map(institutions.map((i) => [i.id, i]));

  const map = new Map();
  for (const s of students) {
    const u = userById.get(s.user_id);
    map.set(s.id, {
      student_id: s.id,
      user_id: s.user_id,
      full_name: u ? u.full_name : null,
      ...(includeContact ? { email: u ? u.email : null, phone: s.phone || (u && u.phone) || null } : {}),
      department: (u && u.department) || null,
      batch_year: s.batch_year || null,
      cgpa: s.cgpa ?? null,
      institution_id: s.institution_id || null,
      institution_name: instById.get(s.institution_id)?.name || null,
      avatar_url: s.avatar_url || null,
      resume_url: includeContact ? s.resume_url || null : undefined,
      github_username: s.github_username || null,
      linkedin_connected: Boolean(s.linkedin_id),
      target_job_role: s.target_job_role || null,
      placement_status: s.placement_status || null,
    });
  }
  return map;
}

// Matching inputs for a set of students: skills (resume + earned badges),
// months of experience, and the resume flattened to text.
async function matchingProfiles(studentIds) {
  const ids = unique(studentIds);
  const [students, resumes, badges] = await Promise.all([
    studentRepository.findByIds(ids),
    findMany(resumeBuilderRepository, 'student_id', ids),
    findMany(studentSkillBadgeRepository, 'student_id', ids),
  ]);
  const users = await userRepository.findByIds(unique(students.map((s) => s.user_id)));
  const userById = new Map(users.map((u) => [u.id, u]));
  const resumeByStudent = new Map(resumes.map((r) => [r.student_id, r]));
  const badgesByStudent = new Map();
  for (const b of badges) {
    if (!badgesByStudent.has(b.student_id)) badgesByStudent.set(b.student_id, []);
    badgesByStudent.get(b.student_id).push(b);
  }

  const map = new Map();
  for (const s of students) {
    const resume = resumeByStudent.get(s.id);
    const earned = (badgesByStudent.get(s.id) || []).map((b) => b.skill_name);
    const skills = uniqueSkills([...toSkillNames(resume && resume.skills), ...earned]);
    const workMonths = experienceMonths(s.work_experience);
    const resumeMonths = resume ? experienceMonths(resume.experience) + experienceMonths(resume.internships) : 0;
    const u = userById.get(s.user_id);
    map.set(s.id, {
      student_id: s.id,
      skills,
      experience_months: Math.max(workMonths, resumeMonths),
      resume_text: `${resumeToText(resume)} ${(s.work_experience || []).map((w) => `${w.jobTitle || ''} ${w.description || ''}`).join(' ')} ${s.target_job_role || ''}`,
      cgpa: s.cgpa ?? null,
      department: (u && u.department) || null,
      batch_year: s.batch_year || null,
      has_resume: Boolean(resume),
    });
  }
  return map;
}

module.exports = { summaries, matchingProfiles, findMany, unique };
