const userRepository = require('../repositories/user.repository');
const studentRepository = require('../repositories/student.repository');
const { hashPassword } = require('./password');
const { ROLES } = require('../config/constants');

// Shared by student.service.js#batchCreate (lightweight roster import, no
// batch tracking) and batch.service.js#create (full batch-tracked import) —
// both python sources (students.py#create_batch_students and
// batches.py#create_batch) duplicated this exact find-or-create block
// verbatim; centralized here as the one implementation both now call.
async function findOrCreateStudentUser({ item, institutionId, department, year, status }) {
  const email = (item.email || `${item.roll || item.studentId}@skillovate.local`).toLowerCase();
  let user = await userRepository.findByEmail(email);
  let created = false;

  if (!user) {
    user = await userRepository.create({
      email,
      password_hash: await hashPassword(item.password || 'student123'),
      full_name: item.name,
      role: ROLES.STUDENT,
      institution_id: institutionId,
      department: item.department || department,
      status,
    });
    await studentRepository.create({
      user_id: user.id,
      institution_id: institutionId,
      roll_number: (item.roll || item.studentId || '').toUpperCase(),
      batch_year: item.year || year,
    });
    created = true;
  }

  return { user, created };
}

module.exports = { findOrCreateStudentUser };
