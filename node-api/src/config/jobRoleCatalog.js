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
  {
    id: 'software-engineer',
    title: 'Software Engineer',
    description: 'Design, build, and maintain software, from problem solving to production systems.',
    skills: ['Data Structures & Algorithms', 'Java', 'Git & GitHub', 'SQL', 'System Design'],
  },
  {
    id: 'java-developer',
    title: 'Java Developer',
    description: 'Build robust enterprise back ends and APIs with Java and Spring.',
    skills: ['Java', 'SQL', 'Git & GitHub', 'Spring Boot', 'REST APIs'],
  },
  {
    id: 'python-developer',
    title: 'Python Developer',
    description: 'Write clean Python for web back ends, automation, and tooling.',
    skills: ['Python', 'SQL', 'Git & GitHub', 'Django', 'REST APIs'],
  },
  {
    id: 'ai-ml-engineer',
    title: 'AI / ML Engineer',
    description: 'Build and ship machine learning and generative AI features.',
    skills: ['Python', 'Machine Learning', 'Deep Learning', 'Natural Language Processing', 'Generative AI'],
  },
  {
    id: 'computer-vision-engineer',
    title: 'Computer Vision Engineer',
    description: 'Teach machines to see: detection, recognition, and image understanding.',
    skills: ['Python', 'Machine Learning', 'Deep Learning', 'Computer Vision'],
  },
  {
    id: 'data-engineer',
    title: 'Data Engineer',
    description: 'Build the pipelines and warehouses that deliver trustworthy data.',
    skills: ['SQL', 'Python', 'Data Engineering', 'Cloud Computing', 'Linux'],
  },
  {
    id: 'business-analyst',
    title: 'Business Analyst',
    description: 'Bridge business needs and technical teams with data and clear requirements.',
    skills: ['Excel', 'SQL', 'Business Analysis', 'Power BI', 'Communication'],
  },
  {
    id: 'bi-developer',
    title: 'BI Developer',
    description: 'Turn company data into dashboards leaders actually use.',
    skills: ['Excel', 'SQL', 'Tableau', 'Power BI', 'Statistics'],
  },
  {
    id: 'cloud-engineer',
    title: 'Cloud Engineer',
    description: 'Design and run infrastructure on the cloud.',
    skills: ['Linux', 'Networking', 'Cloud Computing', 'Docker', 'Terraform'],
  },
  {
    id: 'qa-test-engineer',
    title: 'QA / Test Engineer',
    description: 'Find defects early and automate quality checks.',
    skills: ['Software Testing', 'SQL', 'Git & GitHub', 'Agile & Scrum', 'CI/CD'],
  },
  {
    id: 'penetration-tester',
    title: 'Penetration Tester',
    description: 'Think like an attacker to find weaknesses before they are exploited.',
    skills: ['Networking', 'Linux', 'Cybersecurity', 'Penetration Testing'],
  },
  {
    id: 'embedded-iot-engineer',
    title: 'Embedded / IoT Engineer',
    description: 'Program the devices and sensors that connect the physical world.',
    skills: ['C++', 'Embedded Systems', 'Linux', 'Networking'],
  },
  {
    id: 'game-developer',
    title: 'Game Developer',
    description: 'Build interactive games and real-time experiences.',
    skills: ['C++', 'C#', 'Game Development', 'Git & GitHub'],
  },
  {
    id: 'blockchain-developer',
    title: 'Blockchain Developer',
    description: 'Build decentralised applications and smart contracts.',
    skills: ['JavaScript', 'Blockchain', 'Git & GitHub'],
  },
  {
    id: 'product-manager',
    title: 'Product Manager',
    description: 'Decide what to build and why, and guide it to launch.',
    skills: ['Product Management', 'Agile & Scrum', 'Communication', 'Leadership', 'Data Analysis'],
  },
  {
    id: 'project-manager',
    title: 'Project Manager',
    description: 'Plan, schedule, and deliver projects on time with the team aligned.',
    skills: ['Project Management', 'Agile & Scrum', 'Communication', 'Leadership'],
  },
  {
    id: 'graphic-designer',
    title: 'Graphic Designer',
    description: 'Create visuals and brand assets that communicate clearly.',
    skills: ['Graphic Design', 'UI/UX Design', 'Communication'],
  },
  {
    id: 'content-creator',
    title: 'Content Creator',
    description: 'Write, shoot, and publish content that grows an audience.',
    skills: ['Content Writing', 'Social Media Marketing', 'Video Editing', 'SEO'],
  },
  {
    id: 'hr-talent-acquisition',
    title: 'HR & Talent Acquisition',
    description: 'Find, hire, and look after the people a company runs on.',
    skills: ['Human Resources', 'Communication', 'Leadership'],
  },
  {
    id: 'sales-business-development',
    title: 'Sales & Business Development',
    description: 'Win customers and grow revenue.',
    skills: ['Sales', 'Business Development', 'Customer Relationship Management', 'Communication'],
  },
  {
    id: 'financial-analyst',
    title: 'Financial Analyst',
    description: 'Analyse financial data to guide business and investment decisions.',
    skills: ['Excel', 'Finance', 'Accounting', 'Data Analysis', 'Power BI'],
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
