// A student's outcome after graduating that isn't a job placement: either
// progression to higher education, or a competitive-exam result (GATE, NET,
// CAT, GRE, ...). One collection for both, told apart by `type`, because they
// share everything that matters to the reports — who, which batch, the
// supporting document, and the verify/reject workflow — and differ only in a
// few descriptive fields.
//
//   type 'higher_study':      course, institution_name, admission_year
//   type 'competitive_exam':  exam, exam_year, score, rank_or_percentile, qualified
//
// `proof_url` is the admission proof or the score card (see
// utils/outcomeProofStorage.js).
module.exports = {
  tableName: 'student_outcomes',
  columns: [
    'student_id', 'institution_id', 'type',
    'course', 'institution_name', 'admission_year',
    'exam', 'exam_year', 'score', 'rank_or_percentile', 'qualified',
    'proof_url', 'verification_status', 'verified_by', 'verified_at', 'reported_by',
  ],
  defaults: { verification_status: 'pending' },
  TYPES: { HIGHER_STUDY: 'higher_study', COMPETITIVE_EXAM: 'competitive_exam' },
  EXAMS: ['GATE', 'NET', 'SET', 'CAT', 'GRE', 'GMAT', 'TOEFL', 'IELTS', 'UPSC', 'Other'],
};
