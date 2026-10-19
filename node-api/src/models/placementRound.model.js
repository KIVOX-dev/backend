// What a drive's round actually is — its name, when and where it happens, and
// any instructions. A student's progress is still just the integer
// `placement_applications.round`; this collection only describes each round
// number for a drive, and is what the "shortlisted for round N" email reads.
// Unique per {placement_id, round_number} (scripts/setupIndexes.js).
module.exports = {
  tableName: 'placement_rounds',
  columns: [
    'placement_id', 'institution_id', 'round_number', 'name',
    'scheduled_at', 'venue_or_link', 'instructions',
  ],
};
