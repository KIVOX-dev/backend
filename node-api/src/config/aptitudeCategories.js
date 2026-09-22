// Category -> (display label, one plausible role a strength there points
// toward). Deliberately simple/rule-based, not AI-generated. Shared by
// studentProfile.service.js (a student's own summary) and
// dashboard.service.js (an admin viewing a specific student's insights) —
// see PracticeModule.tsx's CATEGORIES for the same 4 categories on the
// practice-bank side.
const CATEGORY_META = {
  quantitative: { label: 'Quantitative Aptitude', role: 'Data Analyst' },
  logical: { label: 'Logical Reasoning', role: 'Software Developer' },
  verbal: { label: 'Verbal Ability', role: 'Business Analyst' },
  data_interpretation: { label: 'Data Interpretation', role: 'Business Intelligence Analyst' },
};

module.exports = { CATEGORY_META };
