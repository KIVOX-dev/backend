// One spelling per company, so "tcs", "TCS " and "Tcs" are stored (and grouped
// in reports) as the same recruiter. Listed companies use their catalog
// spelling; any other name typed entirely in lower case is title-cased; a name
// with deliberate capitals ("iGate", "McKinsey") is kept exactly as typed.
// Keep COMPANIES in step with COMPANY_OPTIONS in the frontend's CompanyPicker.tsx.
const COMPANIES = [
  'TCS', 'Infosys', 'Wipro', 'HCLTech', 'Tech Mahindra', 'Cognizant', 'Accenture', 'Capgemini',
  'IBM', 'Deloitte', 'Zoho', 'Mindtree', 'Microsoft', 'Google', 'Amazon', 'Flipkart',
  'Oracle', 'SAP', 'Adobe', 'Cisco', 'Dell', 'Freshworks', 'Paytm', 'Zomato',
];

const keyOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

function normalizeCompanyName(name) {
  if (typeof name !== 'string') return name;
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return clean;
  const listed = COMPANIES.find((c) => keyOf(c) === keyOf(clean));
  if (listed) return listed;
  return clean === clean.toLowerCase() ? clean.replace(/(^|[\s&/-])[a-z]/g, (m) => m.toUpperCase()) : clean;
}

module.exports = { normalizeCompanyName };
