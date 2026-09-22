// Curated job roles for the "Choose Your Job Role" setup step and the
// YouTube-to-Course roadmap tab. Deliberately a fixed list (same reasoning as
// skillCatalog.js): deterministic, no AI cost to generate it, and every
// `skills` entry below is copied VERBATIM from skillCatalog.js's SKILLS[].name
// — that's what lets a lesson imported off this roadmap earn a real badge on
// the student's existing Skills tab, not a badge name invented here that the
// rest of the app would never recognize. Order within `skills` is the
// suggested learning order (beginner -> advanced), shown top-to-bottom on the
// roadmap screen.
const ROLES = [
  {
    id: 'frontend-developer',
    title: 'Frontend Developer',
    description: 'Build the interfaces users see and interact with directly in the browser.',
    skills: ['HTML & CSS', 'JavaScript', 'Git & GitHub', 'React', 'TypeScript'],
  },
  {
    id: 'backend-developer',
    title: 'Backend Developer',
    description: 'Build the servers, APIs, and databases that power an application.',
    skills: ['JavaScript', 'Git & GitHub', 'Node.js', 'SQL', 'MongoDB'],
  },
  {
    id: 'full-stack-developer',
    title: 'Full Stack Developer',
    description: 'Work across both the frontend and backend of a web application.',
    skills: ['HTML & CSS', 'JavaScript', 'Git & GitHub', 'React', 'Node.js', 'SQL'],
  },
  {
    id: 'data-analyst',
    title: 'Data Analyst',
    description: 'Turn raw data into charts, dashboards, and decisions.',
    skills: ['Excel', 'SQL', 'Data Analysis', 'Power BI', 'Python'],
  },
  {
    id: 'data-scientist',
    title: 'Data Scientist',
    description: 'Build models that find patterns in data and predict outcomes.',
    skills: ['Python', 'SQL', 'Data Science', 'Machine Learning', 'Deep Learning'],
  },
  {
    id: 'devops-engineer',
    title: 'DevOps Engineer',
    description: 'Automate how software gets built, tested, and deployed.',
    skills: ['Linux', 'Git & GitHub', 'Docker', 'Cloud Computing', 'Kubernetes', 'DevOps'],
  },
  {
    id: 'ui-ux-designer',
    title: 'UI/UX Designer',
    description: 'Design interfaces and experiences that are usable and look great.',
    skills: ['UI/UX Design', 'Communication', 'HTML & CSS'],
  },
  {
    id: 'digital-marketing-specialist',
    title: 'Digital Marketing Specialist',
    description: 'Grow an audience and drive conversions across digital channels.',
    skills: ['Digital Marketing', 'SEO', 'Communication', 'Business Development'],
  },
  {
    id: 'mobile-app-developer',
    title: 'Mobile App Developer',
    description: 'Build apps for Android and iOS.',
    skills: ['JavaScript', 'Git & GitHub', 'UI/UX Design', 'Mobile App Development'],
  },
  {
    id: 'cybersecurity-analyst',
    title: 'Cybersecurity Analyst',
    description: 'Defend systems and networks from attacks and vulnerabilities.',
    skills: ['Networking', 'Linux', 'Cybersecurity', 'Cloud Computing'],
  },
];

const ROLES_BY_ID = new Map(ROLES.map((role) => [role.id, role]));

function listRoles() {
  return ROLES;
}

function getRole(roleId) {
  return ROLES_BY_ID.get(roleId) || null;
}

module.exports = { ROLES, listRoles, getRole };
