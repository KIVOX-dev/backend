// Curated skill names a lesson's own title can be matched against — see
// course.service.js#getLessonAssessment, which tags a lesson with (at most)
// one of these the same time it generates that lesson's quiz questions
// (both derived from the same title, both cached on the lesson so neither
// is redone/re-billed on a later visit). Deliberately a fixed list rather
// than AI-extracted: deterministic, no extra AI cost per lesson, and every
// name here is a real, recognizable skill/credential name — matches what
// StudentSkillBadges/Certificates actually display and put on a LinkedIn
// "Add to Profile" link, so nothing invented shows up there.
//
// Order matters only in that the FIRST match wins — more specific multi-word
// names are listed before short generic ones so e.g. "Node.js" beats a bare
// "JavaScript" catch when both could technically match. `\b` word-boundary
// matching on each keyword means "Java" won't falsely match inside
// "JavaScript" without needing ordering to protect against that specific case.
const SKILLS = [
  { name: 'React', keywords: ['react', 'react.js', 'reactjs'] },
  { name: 'Node.js', keywords: ['node.js', 'nodejs', 'node js'] },
  { name: 'Next.js', keywords: ['next.js', 'nextjs'] },
  { name: 'Vue.js', keywords: ['vue.js', 'vuejs', 'vue'] },
  { name: 'Angular', keywords: ['angular'] },
  { name: 'TypeScript', keywords: ['typescript'] },
  { name: 'JavaScript', keywords: ['javascript', 'js'] },
  { name: 'Python', keywords: ['python'] },
  { name: 'Java', keywords: ['java'] },
  { name: 'C++', keywords: ['c++', 'cpp'] },
  { name: 'C#', keywords: ['c#', 'csharp'] },
  { name: 'Go', keywords: ['golang'] },
  { name: 'Rust', keywords: ['rust'] },
  { name: 'PHP', keywords: ['php'] },
  { name: 'SQL', keywords: ['sql', 'mysql', 'postgresql', 'postgres'] },
  { name: 'MongoDB', keywords: ['mongodb', 'mongo'] },
  { name: 'HTML & CSS', keywords: ['html', 'css'] },
  { name: 'Web Development', keywords: ['web development', 'web dev'] },
  { name: 'Machine Learning', keywords: ['machine learning', 'ml'] },
  { name: 'Deep Learning', keywords: ['deep learning'] },
  { name: 'Data Analysis', keywords: ['data analysis', 'data analytics'] },
  { name: 'Data Science', keywords: ['data science'] },
  { name: 'Artificial Intelligence', keywords: ['artificial intelligence', 'ai'] },
  { name: 'Excel', keywords: ['excel'] },
  { name: 'Power BI', keywords: ['power bi', 'powerbi'] },
  { name: 'Cloud Computing', keywords: ['cloud computing', 'aws', 'azure', 'gcp', 'google cloud'] },
  { name: 'DevOps', keywords: ['devops'] },
  { name: 'Docker', keywords: ['docker'] },
  { name: 'Kubernetes', keywords: ['kubernetes', 'k8s'] },
  { name: 'Git & GitHub', keywords: ['git', 'github'] },
  { name: 'Linux', keywords: ['linux'] },
  { name: 'Networking', keywords: ['networking', 'computer network'] },
  { name: 'Cybersecurity', keywords: ['cybersecurity', 'cyber security', 'ethical hacking'] },
  { name: 'UI/UX Design', keywords: ['ui/ux', 'ux design', 'ui design', 'figma'] },
  { name: 'Digital Marketing', keywords: ['digital marketing'] },
  { name: 'SEO', keywords: ['seo'] },
  { name: 'Business Development', keywords: ['business development'] },
  { name: 'Customer Development', keywords: ['customer development'] },
  { name: 'Customer Relationship Management', keywords: ['crm', 'customer relationship management'] },
  { name: 'Project Management', keywords: ['project management'] },
  { name: 'Product Management', keywords: ['product management'] },
  { name: 'Leadership', keywords: ['leadership'] },
  { name: 'Public Speaking', keywords: ['public speaking'] },
  { name: 'Communication', keywords: ['communication'] },
  { name: 'Sales', keywords: ['sales'] },
  { name: 'Accounting', keywords: ['accounting', 'bookkeeping'] },
  { name: 'Finance', keywords: ['finance', 'financial analysis'] },
  { name: 'Blockchain', keywords: ['blockchain'] },
  { name: 'Mobile App Development', keywords: ['android', 'ios development', 'flutter', 'react native'] },
  { name: 'Game Development', keywords: ['game development', 'unity', 'unreal engine'] },
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns the first catalog skill whose keyword appears as a whole word in
// the title (case-insensitive), or null if nothing matches — a lesson with
// no recognizable skill simply doesn't earn one, rather than guessing.
function matchSkill(title) {
  if (!title) return null;
  for (const skill of SKILLS) {
    for (const keyword of skill.keywords) {
      const pattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i');
      if (pattern.test(title)) return skill.name;
    }
  }
  return null;
}

module.exports = { SKILLS, matchSkill };
