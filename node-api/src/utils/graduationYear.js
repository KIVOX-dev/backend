const DEFAULT_DURATION_YEARS = 3;

// batch_year has historically meant "the calendar year this student's cohort
// belongs to" (see student.model.js's comment distinguishing it from
// year_of_study), but was always just copied verbatim from whatever a human
// typed in — left null whenever nobody supplied one. This computes it
// instead from each department's own program length, so a 3rd-year student
// in a 3-year program and a 3rd-year student in a 4-year program don't get
// the same graduation year. Falls back to DEFAULT_DURATION_YEARS for
// departments that haven't set duration_years yet.
function computeGraduationYear({ durationYears, yearOfStudy, referenceYear }) {
  if (!yearOfStudy) return null;
  const duration = durationYears || DEFAULT_DURATION_YEARS;
  const year = referenceYear || new Date().getFullYear();
  return year + Math.max(0, duration - yearOfStudy);
}

module.exports = { computeGraduationYear, DEFAULT_DURATION_YEARS };
