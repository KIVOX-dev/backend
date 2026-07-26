// Generic per-user JSON blob store — unrelated to any single domain feature.
// Ported from python-service's persistence.py ("userdata" endpoints), which
// the frontend uses to persist arbitrary client-side app state across
// devices/sessions. Full-overwrite semantics on save, no merge — same as the
// python source.
module.exports = {
  tableName: 'user_data_states',
  columns: ['user_id', 'data'],
};
