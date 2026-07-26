const { ROLES } = require('./constants');

// python-service's UserRole enum uses different literal names than node-api's
// ROLES for two of the five roles. Needed anywhere a python-service payload,
// JWT, or seeded document carries its own role vocabulary during the Phase 3
// migration (e.g. one-time data backfills, or compatibility shims while the
// frontend cuts over route by route).
const PYTHON_TO_NODE_ROLE = Object.freeze({
  college_admin: ROLES.INSTITUTION_ADMIN,
  recruiter: ROLES.HR,
  student: ROLES.STUDENT,
  faculty: ROLES.FACULTY,
  super_admin: ROLES.SUPER_ADMIN,
});

function mapPythonRole(pythonRole) {
  return PYTHON_TO_NODE_ROLE[pythonRole] || pythonRole;
}

module.exports = { PYTHON_TO_NODE_ROLE, mapPythonRole };
