// Ported from python-service's profile_data collection — one row per user,
// full-overwrite on save (no merge), `values` shaped by the onboarding
// schema the user's portal maps to (see config/onboardingSchemas.js).
module.exports = {
  tableName: 'profile_data',
  columns: ['user_id', 'portal', 'values'],
};
