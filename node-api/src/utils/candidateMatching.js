// Pure scoring helpers for matching a candidate against a vacancy — no I/O, so
// they are shared by the matching, evaluation and talent-pool services.

const SKILL_ALIASES = {
  js: 'javascript', ecmascript: 'javascript', ts: 'typescript', py: 'python',
  reactjs: 'react', nodejs: 'node', expressjs: 'express', vuejs: 'vue', nextjs: 'next', angularjs: 'angular',
  postgres: 'postgresql', mongo: 'mongodb', k8s: 'kubernetes', golang: 'go', cpp: 'c++', csharp: 'c#',
  ml: 'machinelearning', ai: 'artificialintelligence', dl: 'deeplearning', html5: 'html', css3: 'css',
  amazonwebservices: 'aws', gcp: 'googlecloud',
};

// "Node.js", "node js", "NodeJS" → "node".
function normalizeSkill(raw) {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).toLowerCase().trim();
  if (!s) return '';
  const keep = s.replace(/[^a-z0-9+#]/g, ''); // drop spaces, dots, dashes
  return SKILL_ALIASES[keep] || keep;
}

// Skill lists arrive as plain strings, {name}/{skill}/{label} objects, or a
// comma-separated string, depending on the source (resume builder, badges…).
function toSkillNames(input) {
  if (!input) return [];
  if (typeof input === 'string') return input.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const item of input) {
    if (typeof item === 'string') out.push(...toSkillNames(item));
    else if (item && typeof item === 'object') {
      const v = item.name || item.skill || item.label || item.title;
      if (v) out.push(String(v));
      if (Array.isArray(item.items)) out.push(...toSkillNames(item.items));
      if (Array.isArray(item.skills)) out.push(...toSkillNames(item.skills));
    }
  }
  return out;
}

function uniqueSkills(list) {
  const seen = new Map();
  for (const name of list) {
    const key = normalizeSkill(name);
    if (key && !seen.has(key)) seen.set(key, String(name).trim());
  }
  return [...seen.values()];
}

// % of required skills the candidate holds.
function skillMatch(required, candidateSkills) {
  const req = uniqueSkills(toSkillNames(required));
  if (req.length === 0) return { percent: null, matched: [], missing: [], required_count: 0 };
  const have = new Set(toSkillNames(candidateSkills).map(normalizeSkill));
  const matched = [];
  const missing = [];
  for (const r of req) (have.has(normalizeSkill(r)) ? matched : missing).push(r);
  return { percent: Math.round((matched.length / req.length) * 100), matched, missing, required_count: req.length };
}

// Total months of experience from work_experience entries (see
// studentProfile.validation.js#workExperienceEntry). Overlaps are not merged —
// a student with two concurrent internships is rare enough that this is fine.
function experienceMonths(entries, now = new Date()) {
  if (!Array.isArray(entries)) return 0;
  let months = 0;
  for (const e of entries) {
    if (!e || !e.startYear) continue;
    const open = e.isCurrent || !e.endYear;
    const start = e.startYear * 12 + ((e.startMonth || 1) - 1);
    const endYear = open ? now.getFullYear() : e.endYear;
    const endMonth = open ? now.getMonth() + 1 : e.endMonth || 12;
    const end = endYear * 12 + (endMonth - 1);
    if (end >= start) months += end - start + 1;
  }
  return months;
}

function experienceMatch(requiredYears, months) {
  const years = Math.round((months / 12) * 10) / 10;
  if (!requiredYears || requiredYears <= 0) return { percent: 100, candidate_years: years, required_years: 0 };
  return { percent: Math.min(100, Math.round((years / requiredYears) * 100)), candidate_years: years, required_years: requiredYears };
}

const STOPWORDS = new Set((
  'a an the and or of for to in on at by with from as is are was were be been this that these those it its our we you your they their ' +
  'will can may should must have has had not but if then than so such into over about across per etc using use used work working experience ' +
  'years year strong good excellent ability able knowledge understanding responsible responsibilities required requirements role team join looking ' +
  'candidate candidates job position company skills skill preferred plus including include also well new more all any other which who what ' +
  'build building develop developing development'
).split(/\s+/));

function keywords(text) {
  if (!text) return new Set();
  const tokens = String(text).toLowerCase().match(/[a-z][a-z0-9+#.]*[a-z0-9+#]|[a-z]/g) || [];
  return new Set(tokens.map((t) => normalizeSkill(t)).filter((t) => t.length > 2 && !STOPWORDS.has(t)));
}

// Resume-vs-JD: share of the job description's keywords found in the resume.
function textMatch(jobText, resumeText) {
  const jd = keywords(jobText);
  if (jd.size === 0) return { percent: null, matched_keywords: [] };
  const resume = keywords(resumeText);
  const matched = [...jd].filter((k) => resume.has(k));
  return { percent: Math.round((matched.length / jd.size) * 100), matched_keywords: matched.slice(0, 40), jd_keyword_count: jd.size };
}

// Hard eligibility gates a posting declares (cgpa, department, graduation year).
function checkEligibility(job, candidate) {
  const reasons = [];
  const hasCgpa = candidate.cgpa !== null && candidate.cgpa !== undefined;
  if (job.min_cgpa) {
    if (!hasCgpa) reasons.push('CGPA not available');
    else if (Number(candidate.cgpa) < Number(job.min_cgpa)) reasons.push(`CGPA ${candidate.cgpa} is below the required ${job.min_cgpa}`);
  }
  if (Array.isArray(job.eligible_departments) && job.eligible_departments.length && candidate.department) {
    const ok = job.eligible_departments.some((d) => String(d).toLowerCase() === String(candidate.department).toLowerCase());
    if (!ok) reasons.push(`Department ${candidate.department} is not eligible`);
  }
  if (Array.isArray(job.eligible_years) && job.eligible_years.length && candidate.batch_year) {
    if (!job.eligible_years.map(Number).includes(Number(candidate.batch_year))) reasons.push(`Batch ${candidate.batch_year} is not eligible`);
  }
  return { eligible: reasons.length === 0, reasons };
}

// Weights renormalise over the components that could actually be computed
// (e.g. a job with no description → the text weight is redistributed).
const WEIGHTS = { skills: 0.5, text: 0.15, experience: 0.2, academics: 0.15 };

function academicsScore(job, candidate) {
  if (candidate.cgpa === null || candidate.cgpa === undefined) return null;
  const cgpa = Number(candidate.cgpa);
  if (job.min_cgpa) {
    return cgpa >= job.min_cgpa
      ? Math.min(100, 70 + Math.round((cgpa - job.min_cgpa) * 10))
      : Math.max(0, Math.round((cgpa / job.min_cgpa) * 70));
  }
  return Math.round((Math.min(cgpa, 10) / 10) * 100);
}

// candidate: { skills[], experience_months, resume_text, cgpa, department, batch_year }
function matchCandidate(job, candidate) {
  const skills = skillMatch(job.required_skills, candidate.skills);
  const experience = experienceMatch(job.min_experience_years, candidate.experience_months || 0);
  const text = textMatch(`${job.title || ''} ${job.description || ''}`, candidate.resume_text || '');
  const academics = academicsScore(job, candidate);
  const eligibility = checkEligibility(job, candidate);

  const parts = [
    ['skills', skills.percent],
    ['text', text.percent],
    ['experience', experience.percent],
    ['academics', academics],
  ].filter(([, v]) => v !== null && v !== undefined);
  const totalWeight = parts.reduce((s, [k]) => s + WEIGHTS[k], 0);
  const score = totalWeight ? Math.round(parts.reduce((s, [k, v]) => s + v * WEIGHTS[k], 0) / totalWeight) : 0;

  return {
    match_score: score,
    skill_match_percent: skills.percent,
    matched_skills: skills.matched,
    missing_skills: skills.missing,
    experience_match_percent: experience.percent,
    candidate_experience_years: experience.candidate_years,
    required_experience_years: experience.required_years,
    resume_jd_match_percent: text.percent,
    matched_keywords: text.matched_keywords,
    academics_score: academics,
    eligible: eligibility.eligible,
    ineligibility_reasons: eligibility.reasons,
  };
}

// Flattens every resume section into plain text for textMatch.
function resumeToText(resume) {
  if (!resume) return '';
  const chunks = [];
  const walk = (v) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') chunks.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const key of ['objective', 'education', 'experience', 'projects', 'skills', 'certifications', 'internships', 'achievements', 'hackathons', 'publications', 'customSections']) {
    walk(resume[key]);
  }
  return chunks.join(' ');
}

module.exports = {
  normalizeSkill, toSkillNames, uniqueSkills, skillMatch, experienceMonths, experienceMatch,
  textMatch, checkEligibility, matchCandidate, resumeToText,
};
