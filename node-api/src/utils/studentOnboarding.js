const userRepository = require('../repositories/user.repository');
const studentRepository = require('../repositories/student.repository');
const { hashPassword } = require('./password');
const { sendEmail } = require('../services/email.service');
const { studentWelcomeTemplate } = require('../services/emailTemplates');
const { computeGraduationYear } = require('./graduationYear');
const { ROLES } = require('../config/constants');
const env = require('../config/env');

// The upload/CSV "year" field has always been ambiguous — used for a plain
// calendar year (e.g. 2026, "graduation year") in some rosters and a 1-6
// "current year of study" in others, with nothing distinguishing them.
// A 4-digit-or-larger value is treated as an explicit calendar-year
// override (respected as-is, for callers who already know the real
// graduation year); anything smaller is treated as year_of_study and used
// to compute one instead.
const CALENDAR_YEAR_THRESHOLD = 1000;

// Matches AddStudentPanel.tsx's single-student "Add Student" form, which
// already defaults to this exact password without forcing a change on
// first login — bulk upload previously generated a random secret instead,
// which nobody (faculty or student) actually had, making every
// bulk-uploaded account unusable until someone dug the auto-generated
// password out of an email. Not treated as a one-time temp credential
// (must_change_password stays false for it) since the frontend doesn't
// handle that flow anywhere — forcing it here would just trade "wrong
// password" for a silent broken-auth dead end after login.
const DEFAULT_STUDENT_PASSWORD = 'student123';

function resolveStudyYear({ item, yearOfStudy, year }) {
  return item.year_of_study
    ?? yearOfStudy
    ?? [item.year, year].find((v) => typeof v === 'number' && v > 0 && v < CALENDAR_YEAR_THRESHOLD);
}

function resolveBatchYear({ item, year, studyYear, departmentDurationYears }) {
  const explicit = [item.batch_year, item.year, year].find((v) => typeof v === 'number' && v >= CALENDAR_YEAR_THRESHOLD);
  if (explicit) return explicit;
  return computeGraduationYear({ durationYears: departmentDurationYears, yearOfStudy: studyYear });
}

// Shared by student.service.js#batchCreate (lightweight roster import, no
// batch tracking) and batch.service.js#create (full batch-tracked import) —
// both python sources (students.py#create_batch_students and
// batches.py#create_batch) duplicated this exact find-or-create block
// verbatim; centralized here as the one implementation both now call.
async function findOrCreateStudentUser({ item, institutionId, department, departmentId, year, yearOfStudy, departmentDurationYears, status }) {
  const isSyntheticEmail = !item.email;
  const email = (item.email || `${item.roll || item.studentId}@upscaler-ai.local`).toLowerCase();
  let user = await userRepository.findByEmail(email);
  let created = false;
  let tempPassword = null;

  if (!user) {
    // An explicitly admin-supplied password is respected as-is; otherwise
    // every bulk-uploaded student gets the same known default (see
    // DEFAULT_STUDENT_PASSWORD above) rather than an unrecoverable random one.
    const suppliedPassword = item.password;
    const resolvedPassword = suppliedPassword || DEFAULT_STUDENT_PASSWORD;

    user = await userRepository.create({
      email,
      password_hash: await hashPassword(resolvedPassword),
      full_name: item.name,
      role: ROLES.STUDENT,
      institution_id: institutionId,
      department: item.department || department,
      status,
    });
    const studyYear = resolveStudyYear({ item, yearOfStudy, year });
    await studentRepository.create({
      user_id: user.id,
      institution_id: institutionId,
      department_id: item.department_id || departmentId || null,
      roll_number: (item.roll || item.studentId || '').toUpperCase(),
      batch_year: resolveBatchYear({ item, year, studyYear, departmentDurationYears }),
      year_of_study: studyYear || null,
    });
    created = true;

    if (!suppliedPassword) {
      tempPassword = resolvedPassword;
      // Best-effort — sendEmail never throws, and there's nowhere to send a
      // synthetic @upscaler-ai.local fallback address anyway.
      if (!isSyntheticEmail) {
        const { subject, html, text } = studentWelcomeTemplate({
          fullName: item.name,
          email,
          tempPassword,
          loginUrl: `${env.frontendUrl}/login`,
        });
        await sendEmail({ to: email, subject, html, text });
      }
    }
  }

  return { user, created, tempPassword };
}

module.exports = { findOrCreateStudentUser };
