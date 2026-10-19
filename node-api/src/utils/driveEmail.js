const env = require('../config/env');
const { emailLogoUrl } = require('./companyLogo');
const { formatIstDate } = require('./istFormat');

// A drive students can act on: published (not a draft/closed/cancelled one)
// and still switched on. HR postings carry no institution_id — they aren't
// campus drives with a roster to email, so they never qualify.
const LIVE_STATUSES = ['open', 'active'];

function isDriveLive(placement) {
  return Boolean(
    placement
    && placement.institution_id
    && LIVE_STATUSES.includes(placement.status)
    && placement.is_active !== false
  );
}

const lpa = (n) => String(Number(n));

// Uses the salary range when both ends are set, else the single package.
function packageCtc(placement) {
  const { salary_min_lpa: min, salary_max_lpa: max, package_lpa: pkg } = placement;
  if (min != null && max != null && Number(max) > Number(min)) return `₹${lpa(min)}–${lpa(max)} LPA`;
  const single = pkg ?? min ?? max;
  return single != null ? `₹${lpa(single)} LPA` : 'Not disclosed';
}

const asList = (value) => (Array.isArray(value) ? value.filter((v) => v !== null && v !== '') : []);

function eligibilitySummary(placement) {
  const parts = [];
  const departments = asList(placement.eligible_departments);
  const years = asList(placement.eligible_years);
  if (departments.length) parts.push(`Departments: ${departments.join(', ')}`);
  if (years.length) parts.push(`Batches: ${years.join(', ')}`);
  if (placement.min_cgpa) parts.push(`Minimum CGPA: ${placement.min_cgpa}`);
  return parts.length ? parts.join(' · ') : 'Open to all students';
}

function driveLink() {
  return `${env.frontendUrl.replace(/\/$/, '')}${env.notifications.driveLinkPath}`;
}

// Params shared by both drive emails. companyLogoUrl is '' when there is no
// public logo, which is what the Brevo template's {% if %} falls back on.
function commonDriveParams(placement) {
  return {
    companyName: placement.company_name || 'the company',
    companyLogoUrl: emailLogoUrl(placement.company_logo_url),
    jobRole: placement.title,
    driveLink: driveLink(),
  };
}

function driveAssignedParams(placement) {
  return {
    ...commonDriveParams(placement),
    packageCtc: packageCtc(placement),
    location: placement.location || '',
    driveDate: formatIstDate(placement.drive_date, ''),
    lastDateToApply: formatIstDate(placement.application_deadline, ''),
    eligibilitySummary: eligibilitySummary(placement),
  };
}

module.exports = { isDriveLive, packageCtc, eligibilitySummary, commonDriveParams, driveAssignedParams };
