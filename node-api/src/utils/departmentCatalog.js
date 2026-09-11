// Master department/program catalog, split by college stream, plus the
// college-type heuristic and department-code generation used to seed a new
// institution's departments automatically. Ported verbatim from the
// frontend's d:\Upscaler-frontend\src\lib\departmentCatalog.ts (no shared
// package between the two apps — same precedent as seedPracticeTests.js
// pulling frontend content into a backend script). Keep the two in sync if
// either changes.
//
// Used by both institution.service.js#create (auto-seeds a brand-new
// institution's departments at creation time) and scripts/seedDepartments.js
// (idempotent backfill/re-run for institutions that predate this module, or
// were created through some other path that skipped it).

const ENGINEERING_DEPARTMENTS = [
  'B.E. Computer Science and Engineering (CSE)',
  'B.E. Electronics and Communication Engineering (ECE)',
  'B.E. Electrical and Electronics Engineering (EEE)',
  'B.E. Electrical Engineering (EE)',
  'B.E. Mechanical Engineering',
  'B.E. Civil Engineering',
  'B.E. Automobile Engineering',
  'B.E. Mechatronics Engineering',
  'B.E. Robotics and Automation',
  'B.E. Biomedical Engineering',
  'B.E. Aeronautical Engineering',
  'B.E. Aerospace Engineering',
  'B.E. Marine Engineering',
  'B.E. Mining Engineering',
  'B.E. Industrial Engineering',
  'B.E. Production Engineering',
  'B.E. Manufacturing Engineering',
  'B.E. Printing Technology',
  'B.E. Electronics and Instrumentation Engineering (EIE)',
  'B.E. Instrumentation and Control Engineering',
  'B.E. Environmental Engineering',
  'B.E. Geoinformatics',
  'B.E. Petrochemical Engineering',
  'B.E. Metallurgical Engineering',
  'B.E. Ceramic Engineering',
  'B.E. Agricultural Engineering',
  'B.E. Computer Science and Design',
  'B.Tech. Information Technology (IT)',
  'B.Tech. Artificial Intelligence and Data Science (AI & DS)',
  'B.Tech. Artificial Intelligence and Machine Learning (AI & ML)',
  'B.Tech. Data Science',
  'B.Tech. Biotechnology',
  'B.Tech. Chemical Engineering',
  'B.Tech. Food Technology',
  'B.Tech. Pharmaceutical Technology',
  'B.Tech. Textile Technology',
  'B.Tech. Textile Chemistry',
  'B.Tech. Fashion Technology',
  'B.Tech. Leather Technology',
  'B.Tech. Polymer Technology',
  'B.Tech. Plastic Technology',
  'B.Tech. Industrial Biotechnology',
  'B.Tech. Information Science and Engineering (ISE)',
  'B.Tech. Computer Science and Business Systems (CSBS)',
  'B.Tech. Computer Science and Engineering (Cyber Security)',
  'B.Tech. Computer Science and Engineering (Artificial Intelligence)',
  'B.Tech. Computer Science and Engineering (Data Science)',
  'B.Tech. Computer Science and Engineering (Internet of Things)',
  'B.Tech. Computer Science and Engineering (Blockchain Technology)',
  'B.Tech. Computer Science and Engineering (Cloud Computing)',
  'B.Tech. Computer Science and Engineering (AI & Cyber Security)',
  'B.Tech. Computer Science and Engineering (IoT and Cyber Security including Blockchain)',
  'B.Tech. Electronics Engineering (VLSI Design and Technology)',
  'B.Tech. Electronics and Computer Engineering',
  'B.Tech. Electronics Engineering',
  'B.Tech. Renewable Energy Engineering',
  'B.Tech. Energy Engineering',
  'B.Tech. Nanotechnology',
  'B.Tech. Medical Electronics',
];

const ARTS_SCIENCE_DEPARTMENTS = [
  'B.A. English',
  'B.A. Tamil',
  'B.A. History',
  'B.A. Economics',
  'B.A. Sociology',
  'B.A. Political Science',
  'B.A. Public Administration',
  'B.A. Journalism',
  'B.A. Visual Communication',
  'B.A. Philosophy',
  'B.A. Geography',
  'B.A. Anthropology',
  'B.A. Criminology',
  'B.A. Defence and Strategic Studies',
  'B.A. Tourism and Travel Management',
  'B.A. Functional English',
  'B.A. Linguistics',
  'B.A. Archaeology',
  'B.A. Rural Development',
  'B.Sc. Computer Science',
  'B.Sc. Information Technology',
  'B.Sc. Computer Technology',
  'B.Sc. Software Systems',
  'B.Sc. Information Systems',
  'B.Sc. Artificial Intelligence',
  'B.Sc. Artificial Intelligence and Machine Learning',
  'B.Sc. Data Science',
  'B.Sc. Cyber Security',
  'B.Sc. Mathematics',
  'B.Sc. Statistics',
  'B.Sc. Physics',
  'B.Sc. Chemistry',
  'B.Sc. Electronics',
  'B.Sc. Electronics and Communication',
  'B.Sc. Biotechnology',
  'B.Sc. Biochemistry',
  'B.Sc. Microbiology',
  'B.Sc. Botany',
  'B.Sc. Zoology',
  'B.Sc. Psychology',
  'B.Sc. Forensic Science',
  'B.Sc. Environmental Science',
  'B.Sc. Geography',
  'B.Sc. Geology',
  'B.Sc. Marine Biology',
  'B.Sc. Fisheries Science',
  'B.Sc. Agriculture',
  'B.Sc. Horticulture',
  'B.Sc. Forestry',
  'B.Sc. Home Science',
  'B.Sc. Nutrition and Dietetics',
  'B.Sc. Food Science and Nutrition',
  'B.Sc. Costume Design and Fashion',
  'B.Sc. Fashion Technology',
  'B.Sc. Visual Communication',
  'B.Sc. Animation and Multimedia',
  'B.Sc. Hotel Management and Catering Science',
  'B.Sc. Medical Laboratory Technology',
  'B.Sc. Clinical Laboratory Technology',
  'B.Sc. Radiology and Imaging Technology',
  'B.Sc. Operation Theatre Technology',
  'B.Sc. Optometry',
  'B.Sc. Nursing',
  'B.Sc. Cardiac Technology',
  'B.Sc. Respiratory Therapy',
  'B.Sc. Dialysis Technology',
  'B.Sc. Emergency Medical Care',
  'B.Sc. Yoga',
  'B.Sc. Physical Education',
  'B.Sc. Sports Science',
  'B.Com.',
  'B.Com. Computer Applications',
  'B.Com. Accounting and Finance',
  'B.Com. Professional Accounting',
  'B.Com. Banking and Insurance',
  'B.Com. Corporate Secretaryship',
  'B.Com. Business Process Services',
  'B.Com. Taxation',
  'B.Com. Finance',
  'B.Com. Financial Markets',
  'B.Com. International Business',
  'B.Com. E-Commerce',
  'B.Com. Honors',
  'B.B.A.',
  'B.B.A. Computer Applications',
  'B.B.A. Business Analytics',
  'B.B.A. Logistics',
  'B.B.A. Aviation Management',
  'B.B.A. Hospital Management',
  'B.B.A. Retail Management',
  'B.B.A. Human Resource Management',
  'B.B.A. International Business',
  'B.B.A. Entrepreneurship',
  'B.B.A. Finance',
  'B.B.A. Marketing',
  'B.C.A.',
  'B.C.A. Artificial Intelligence',
  'B.C.A. Data Science',
  'B.C.A. Cyber Security',
  'B.C.A. Cloud Computing',
  'B.C.A. Internet of Things',
  'B.S.W.',
  'B.Lib.I.Sc.',
  'B.Voc. Software Development',
  'B.Voc. Banking and Financial Services',
  'B.Voc. Retail Management',
  'B.Voc. Healthcare',
  'B.Voc. Tourism and Hospitality',
  'B.Voc. Animation',
  'B.Voc. Multimedia',
  'B.Voc. Fashion Technology',
  'M.A. English',
  'M.A. Tamil',
  'M.A. History',
  'M.A. Economics',
  'M.A. Sociology',
  'M.A. Political Science',
  'M.A. Public Administration',
  'M.A. Journalism and Mass Communication',
  'M.A. Psychology',
  'M.A. Philosophy',
  'M.Sc. Computer Science',
  'M.Sc. Information Technology',
  'M.Sc. Artificial Intelligence',
  'M.Sc. Artificial Intelligence and Machine Learning',
  'M.Sc. Data Science',
  'M.Sc. Cyber Security',
  'M.Sc. Mathematics',
  'M.Sc. Statistics',
  'M.Sc. Physics',
  'M.Sc. Chemistry',
  'M.Sc. Biotechnology',
  'M.Sc. Biochemistry',
  'M.Sc. Microbiology',
  'M.Sc. Botany',
  'M.Sc. Zoology',
  'M.Sc. Psychology',
  'M.Sc. Forensic Science',
  'M.Sc. Environmental Science',
  'M.Sc. Electronics',
  'M.Sc. Food Science and Nutrition',
  'M.Sc. Software Systems',
  'M.Com.',
  'M.Com. Computer Applications',
  'M.Com. Finance',
  'M.Com. Banking',
  'M.Com. International Business',
  'M.B.A.',
  'M.B.A. Finance',
  'M.B.A. Marketing',
  'M.B.A. Human Resource Management',
  'M.B.A. Business Analytics',
  'M.B.A. Logistics and Supply Chain Management',
  'M.B.A. Hospital Management',
  'M.B.A. International Business',
  'M.B.A. Operations Management',
  'M.B.A. Systems Management',
  'M.C.A.',
  'M.C.A. Artificial Intelligence',
  'M.C.A. Data Science',
  'M.C.A. Cloud Computing',
  'M.C.A. Cyber Security',
  'M.S.W.',
  'M.Lib.I.Sc.',
  'M.Phil.',
  'Ph.D.',
];

const ENGINEERING_NAME_PATTERN = /\bengineering\b|\binstitute of technology\b|\bpolytechnic\b/i;
const ARTS_SCIENCE_NAME_PATTERN = /\barts\b.*\bscience\b|\bscience\b.*\barts\b|\bcommerce\b|\barts\b|\bscience\b/i;

function inferCollegeType(name) {
  if (!name) return 'unspecified';
  if (ENGINEERING_NAME_PATTERN.test(name)) return 'engineering';
  if (ARTS_SCIENCE_NAME_PATTERN.test(name)) return 'arts_and_science';
  return 'unspecified';
}

function getDepartmentNames(collegeName) {
  const type = inferCollegeType(collegeName);
  if (type === 'engineering') return ENGINEERING_DEPARTMENTS;
  if (type === 'arts_and_science') return ARTS_SCIENCE_DEPARTMENTS;
  return [...ENGINEERING_DEPARTMENTS, ...ARTS_SCIENCE_DEPARTMENTS];
}

// Sorted longest-first so "B.Lib.I.Sc." isn't shadowed by a shorter partial
// prefix match (e.g. "B.Sc." would otherwise never get a chance to match).
const DEGREE_PREFIXES = [
  'B.Lib.I.Sc.', 'M.Lib.I.Sc.', 'B.Tech.', 'B.Voc.', 'M.Phil.', 'Ph.D.',
  'B.E.', 'B.A.', 'B.Sc.', 'B.Com.', 'B.B.A.', 'B.C.A.', 'B.S.W.',
  'M.A.', 'M.Sc.', 'M.Com.', 'M.B.A.', 'M.C.A.', 'M.S.W.',
].sort((a, b) => b.length - a.length);

const STOPWORDS = new Set(['and', 'of', 'in', 'the', 'for']);

function codeFor(name) {
  const parenMatch = name.match(/\(([^)]+)\)/);
  if (parenMatch) return parenMatch[1].trim().toUpperCase().slice(0, 50);

  let rest = name;
  let matchedPrefix = null;
  for (const prefix of DEGREE_PREFIXES) {
    if (rest.startsWith(prefix)) {
      matchedPrefix = prefix;
      rest = rest.slice(prefix.length).trim();
      break;
    }
  }

  const words = rest.split(/\s+/).filter((w) => w && !STOPWORDS.has(w.toLowerCase()));
  if (words.length === 0) {
    // Nothing left after stripping the degree prefix (e.g. "B.Com." or
    // "Ph.D." on their own) — fall back to the prefix's own letters.
    const fallback = (matchedPrefix || name).replace(/[^A-Za-z]/g, '').toUpperCase();
    return (fallback || 'GEN').slice(0, 50);
  }
  return words.map((w) => w[0].toUpperCase()).join('').slice(0, 50);
}

// Two different programs can plausibly reduce to the same initials (e.g.
// "B.E. Automobile Engineering" and "B.E. Aerospace Engineering" both -> AE)
// — codes only need to be distinct within one institution's own seeded set,
// so just number the collisions rather than trying to make every code
// globally unique or perfectly descriptive.
function uniqueCode(baseCode, usedCodes) {
  if (!usedCodes.has(baseCode)) return baseCode;
  let n = 2;
  while (usedCodes.has(`${baseCode}-${n}`)) n += 1;
  return `${baseCode}-${n}`;
}

module.exports = {
  ENGINEERING_DEPARTMENTS,
  ARTS_SCIENCE_DEPARTMENTS,
  inferCollegeType,
  getDepartmentNames,
  codeFor,
  uniqueCode,
};
