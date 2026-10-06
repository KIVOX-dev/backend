// A candidate an organisation has saved for reuse across vacancies.
module.exports = {
  tableName: 'hr_talent_pool',
  columns: [
    'org_id', 'student_id', 'added_by', 'category', 'tags', 'skills', 'rating', 'notes',
    'status', 'source_placement_id', 'last_contacted_at', 'used_in_placements',
  ],
  defaults: { tags: [], skills: [], status: 'active', used_in_placements: [] },
};
