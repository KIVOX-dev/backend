module.exports = {
  tableName: 'departments',
  // duration_years: length of the program in years (e.g. 3 for most B.A./
  // B.Sc./B.Com. programs here, 4 for some B.Sc. allied-health programs) —
  // used to compute a student's graduation year from their year_of_study
  // (see utils/graduationYear.js) instead of requiring it to be typed in
  // manually on every upload.
  columns: ['institution_id', 'name', 'code', 'duration_years'],
};
