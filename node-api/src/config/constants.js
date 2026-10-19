const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  INSTITUTION_ADMIN: 'institution_admin',
  HR: 'hr',
  FACULTY: 'faculty',
  STUDENT: 'student',
});

const ALL_ROLES = Object.values(ROLES);

// The password every onboarded student gets unless an admin supplies one (see
// utils/studentOnboarding.js). Shared with the account-created email, which
// shows it to students who still have it.
const DEFAULT_STUDENT_PASSWORD = 'student123';

module.exports = { ROLES, ALL_ROLES, DEFAULT_STUDENT_PASSWORD };
