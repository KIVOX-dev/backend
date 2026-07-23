const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  INSTITUTION_ADMIN: 'institution_admin',
  HR: 'hr',
  FACULTY: 'faculty',
  STUDENT: 'student',
});

const ALL_ROLES = Object.values(ROLES);

module.exports = { ROLES, ALL_ROLES };
