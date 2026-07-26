// Ported from python-service's placements.py. Deliberately a SEPARATE
// collection from node-api's existing `placements` (job drives/postings,
// see placement.model.js) — the two share a name but not a meaning: this one
// is an individual student's self-reported placement OUTCOME (verified
// after the fact), not a job opening students apply to.
module.exports = {
  tableName: 'placement_records',
  columns: [
    'student_id', 'institution_id', 'company_name', 'role', 'salary_lpa',
    'work_type', 'mode', 'location', 'proof_url', 'offer_date', 'status',
    'verified_by', 'verification_status', 'verified_at',
  ],
  defaults: { status: 'placed', verification_status: 'pending' },
};
