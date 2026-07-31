const userRepository = require('../repositories/user.repository');
const studentRepository = require('../repositories/student.repository');
const { hashPassword, generateSecurePassword } = require('./password');
const { sendEmail } = require('../services/email.service');
const { studentWelcomeTemplate } = require('../services/emailTemplates');
const { ROLES } = require('../config/constants');
const env = require('../config/env');

// Shared by student.service.js#batchCreate (lightweight roster import, no
// batch tracking) and batch.service.js#create (full batch-tracked import) —
// both python sources (students.py#create_batch_students and
// batches.py#create_batch) duplicated this exact find-or-create block
// verbatim; centralized here as the one implementation both now call.
async function findOrCreateStudentUser({ item, institutionId, department, departmentId, year, status }) {
  const isSyntheticEmail = !item.email;
  const email = (item.email || `${item.roll || item.studentId}@upscaler-ai.local`).toLowerCase();
  let user = await userRepository.findByEmail(email);
  let created = false;
  let tempPassword = null;

  if (!user) {
    // An explicitly admin-supplied password is respected as-is, no forced
    // change — only an auto-generated one requires changing it on first login.
    const suppliedPassword = item.password;
    const generatedPassword = suppliedPassword || generateSecurePassword();

    user = await userRepository.create({
      email,
      password_hash: await hashPassword(generatedPassword),
      full_name: item.name,
      role: ROLES.STUDENT,
      institution_id: institutionId,
      department: item.department || department,
      status,
      must_change_password: !suppliedPassword,
    });
    await studentRepository.create({
      user_id: user.id,
      institution_id: institutionId,
      department_id: item.department_id || departmentId || null,
      roll_number: (item.roll || item.studentId || '').toUpperCase(),
      batch_year: item.year || year,
    });
    created = true;

    if (!suppliedPassword) {
      tempPassword = generatedPassword;
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
