// Matches a free-text department name/code (e.g. from a CSV column or the
// self-service signup form) against an institution's real department rows —
// same matching rule the frontend already uses at upload time (see
// FacultyUpload.tsx#resolveDepartmentId), duplicated here so the backend can
// re-resolve a department_id later (at approval, or via a backfill script)
// for rows where it was never captured in the first place.
function resolveDepartmentIdByName(raw, departments) {
  if (!raw) return null;
  const needle = String(raw).trim().toLowerCase();
  if (!needle) return null;
  const match = departments.find(
    (d) => d.name?.toLowerCase() === needle || (d.code && d.code.toLowerCase() === needle)
  );
  return match ? match.id : null;
}

module.exports = { resolveDepartmentIdByName };
