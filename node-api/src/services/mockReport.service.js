// Final consolidated report, generated once Round 3 ends. Built from stored round results only.
// Two layers: a deterministic rules-based report that always works, and an optional ai-service
// enrichment (strengths, missed opportunities, suggestions in the model's words). The AI layer
// can never fail or block the report: any error or malformed reply falls back to the rules.
const userRepository = require('../repositories/user.repository');
const studentRepository = require('../repositories/student.repository');
const aiClient = require('../utils/aiServiceClient');
const logger = require('../utils/logger');
const { GD_PARAMS, HR_PARAMS, ROUND_WEIGHTS } = require('../utils/mockScoring');

const GD_LABELS = {
  content_relevance: 'Content & relevance',
  communication_clarity: 'Communication clarity',
  initiative: 'Initiative',
  listening_building: 'Listening & building on others',
  leadership_collaboration: 'Leadership & collaboration',
  time_management_conclusion: 'Time management & conclusion',
};
const HR_LABELS = {
  content_quality: 'Content quality',
  communication_confidence: 'Communication clarity & confidence',
  answer_structure: 'Structure of answers (STAR)',
  relevance: 'Relevance',
  professionalism: 'Professionalism',
  self_awareness: 'Self-awareness',
};
const ROUND_TITLES = { 1: 'Written test', 2: 'Group discussion', 3: 'HR interview' };

// Every suggestion carries a concrete action the student can do before the next attempt.
const GD_SUGGESTIONS = {
  content_relevance: ['Back your points with substance.', 'Before the next group discussion, prepare 3 facts or examples for the topic and start each point with "My point is ... because ...".'],
  communication_clarity: ['Speak in shorter, cleaner sentences.', 'Record a 2-minute talk every day this week and replace each "um" or "like" with a one-second pause; aim for under 3 fillers a minute.'],
  initiative: ['Take the first turn more often.', 'Open the next discussion within 20 seconds with a one-line definition of the topic and your stand.'],
  listening_building: ['Build on what others say.', 'Use "Building on <name>\'s point ..." at least twice in every discussion.'],
  leadership_collaboration: ['Bring others into the discussion.', 'Invite one quiet participant by name and summarise two views before adding your own.'],
  time_management_conclusion: ['Close the discussion yourself.', 'Keep the last 20 seconds for a two-sentence conclusion that names both sides and your final stand.'],
};
const HR_SUGGESTIONS = {
  content_quality: ['Give a specific example in every answer.', 'Write one real story from a project or internship for each of: teamwork, pressure, failure, leadership, and use them in your answers.'],
  communication_confidence: ['Sound calmer and clearer.', 'Practise answering out loud for 60 seconds per question and watch for filler words.'],
  answer_structure: ['Structure answers with STAR.', 'For each answer, say one sentence each for Situation, Task, Action and Result, ending with a number if you can.'],
  relevance: ['Answer the question that was asked.', 'Restate the question in your own words in 5 seconds, then answer only that.'],
  professionalism: ['Keep a professional tone.', 'Prepare a clear 20-second self-introduction and avoid casual filler phrases.'],
  self_awareness: ['Show you know your strengths and gaps.', 'Prepare one genuine weakness, what you are doing about it, and one measurable improvement so far.'],
};

const clip = (t, n) => (String(t || '').length > n ? `${String(t).slice(0, n - 1).trimEnd()}…` : String(t || ''));

function byParam(scores, labels, order) {
  return order.map((key) => ({ key, label: labels[key], score: scores[key] ?? 0 })).filter((p) => p.label);
}

// A better sample line per kind of HR question (grounded in the student's role and company).
function betterLine(question, { role, company }) {
  const q = question.toLowerCase();
  const at = company ? ` at ${company}` : '';
  if (/yourself|introduc/.test(q)) return `I am a final-year student who built [project] using [skills]; my main strength is [strength], and I am looking to grow as a ${role}${at}.`;
  if (/strength|weakness/.test(q)) return 'My strength is [skill], shown when I [example with a result]. A weakness I am working on is [gap]; I am improving it by [action] and have already [result].';
  if (/why .*(join|company|us)|interested in/.test(q)) return `I want to join${company ? ` ${company}` : ' this company'} because of [specific reason], and my skills in [skill] fit the ${role} role.`;
  if (/team|conflict/.test(q)) return 'In my [project], our team disagreed about [issue]. I listened to both sides, proposed [solution], and we delivered [result].';
  if (/pressure|stress|deadline/.test(q)) return 'When [deadline situation] came up, I listed priorities, split the work, and finished [result] on time.';
  if (/goal|years|future/.test(q)) return `In five years I want to be a strong ${role}: in year one I will [learn], then [grow], so I can [contribute] to the team.`;
  return 'In [situation], I was responsible for [task]. I [action], which led to [measurable result].';
}

function rulesReport({ session, rounds, student, user }) {
  const byRound = Object.fromEntries(rounds.map((r) => [r.round, r]));
  const ctx = { role: session.role, company: session.company };
  const gd = byRound[2];
  const hr = byRound[3];
  const mcq = byRound[1];

  const roundSummaries = rounds.map((r) => {
    let params;
    let strengths;
    let improvements;
    if (r.round === 1) {
      const topics = (r.payload?.topic_scores || []).map((t) => ({ key: t.section, label: t.section, score: t.score }));
      params = topics;
    } else if (r.round === 2) params = byParam(r.parameter_scores, GD_LABELS, GD_PARAMS);
    else params = byParam(r.parameter_scores, HR_LABELS, HR_PARAMS);
    strengths = params.filter((p) => p.score >= 7).map((p) => p.label);
    improvements = params.filter((p) => p.score <= 5).map((p) => p.label);
    if (!strengths.length && params.length) strengths = [[...params].sort((a, b) => b.score - a.score)[0].label];
    if (!improvements.length && params.length) improvements = [[...params].sort((a, b) => a.score - b.score)[0].label];
    return { round: r.round, title: ROUND_TITLES[r.round], overall_score: r.overall_score, parameters: params, strengths, improvements };
  });

  // Notable answers: the two best-scoring HR answers.
  const pairs = (hr?.payload?.pairs || []).filter((p) => p.answer && p.answer.trim());
  const notable_answers = [...pairs].sort((a, b) => b.score - a.score).slice(0, 2)
    .map((p) => ({ round: 3, question: p.question, answer: clip(p.answer, 320), note: p.note, score: p.score }));

  // Missed opportunities: GD behaviours, then the weakest HR answers.
  const missed = [];
  const m = gd?.payload?.metrics;
  const topic = gd?.payload?.topic || 'the topic';
  if (m && !m.opened_discussion) {
    missed.push({ round: 2, moment: 'The discussion started without you; others set the direction.', sample_better_line: `Let me start with a quick definition of "${clip(topic, 80)}": my view is [stand] because [reason].` });
  }
  if (m && m.references_to_others === 0) {
    missed.push({ round: 2, moment: 'Other participants made points you did not respond to.', sample_better_line: 'Building on Deep\'s point about the data, I would add [your point], which supports [your stand].' });
  }
  if (m && !m.concluded_discussion) {
    missed.push({ round: 2, moment: 'The discussion ended without a conclusion from you.', sample_better_line: 'To conclude: we agreed on [common ground], we differed on [difference], and my final view is [stand].' });
  }
  [...pairs].sort((a, b) => a.score - b.score).filter((p) => p.score < 6).slice(0, 2).forEach((p) => {
    missed.push({ round: 3, moment: `Your answer to "${clip(p.question, 90)}" was thin or unstructured.`, sample_better_line: betterLine(p.question, ctx) });
  });

  // Suggestions from the weakest dimensions across rounds, each with an action.
  const weak = [];
  if (gd) byParam(gd.parameter_scores, GD_LABELS, GD_PARAMS).forEach((p) => weak.push({ ...p, table: GD_SUGGESTIONS }));
  if (hr) byParam(hr.parameter_scores, HR_LABELS, HR_PARAMS).forEach((p) => weak.push({ ...p, table: HR_SUGGESTIONS }));
  const suggestions = weak.sort((a, b) => a.score - b.score).slice(0, 4).map((p) => {
    const [text, action] = p.table[p.key];
    return { text, action, area: p.label };
  });
  (mcq?.payload?.topic_scores || []).filter((t) => t.score <= 5).slice(0, 1).forEach((t) => {
    suggestions.push({ text: `Strengthen ${t.section} for the written test.`, action: `Do 10 timed ${t.section} questions every day for a week and review each mistake.`, area: t.section });
  });

  const overall = session.overall_score ?? 0;
  const dateNow = session.completed_at || new Date();
  return {
    generated_at: new Date(),
    source: 'rules',
    attempt_id: session.id,
    date: dateNow,
    student: {
      name: user?.full_name || user?.name || user?.email || 'Student',
      email: user?.email || null,
      roll_number: student?.roll_number || null,
    },
    role: session.role,
    company: session.company || null,
    overall_score: overall,
    round_scores: { 1: byRound[1]?.overall_score ?? null, 2: byRound[2]?.overall_score ?? null, 3: byRound[3]?.overall_score ?? null },
    weights: ROUND_WEIGHTS,
    rounds: roundSummaries,
    gd_metrics: m || null,
    notable_answers,
    missed_opportunities: missed,
    suggestions,
  };
}

const isStr = (v, max = 400) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

// Accepts AI output only where it is well-formed; anything else keeps the rules' value.
function mergeAi(base, ai) {
  if (!ai || ai.source !== 'ai') return base;
  const out = { ...base };
  const suggestions = (ai.suggestions || []).filter((s) => isStr(s?.text) && isStr(s?.action)).slice(0, 6)
    .map((s) => ({ text: s.text.trim(), action: s.action.trim(), area: isStr(s.area, 80) ? s.area : undefined }));
  if (suggestions.length >= 2) out.suggestions = suggestions;
  const missed = (ai.missed_opportunities || []).filter((x) => [2, 3].includes(Number(x?.round)) && isStr(x?.moment) && isStr(x?.sample_better_line)).slice(0, 6)
    .map((x) => ({ round: Number(x.round), moment: x.moment.trim(), sample_better_line: x.sample_better_line.trim() }));
  if (missed.length) out.missed_opportunities = missed;
  const overallStrengths = (ai.strengths || []).filter((s) => isStr(s, 200)).slice(0, 5);
  const overallImprovements = (ai.improvements || []).filter((s) => isStr(s, 200)).slice(0, 5);
  if (overallStrengths.length) out.overall_strengths = overallStrengths;
  if (overallImprovements.length) out.overall_improvements = overallImprovements;
  out.source = 'ai';
  return out;
}

async function aiEnrichment(base, rounds, session) {
  const byRound = Object.fromEntries(rounds.map((r) => [r.round, r]));
  const gd = byRound[2];
  const hr = byRound[3];
  const body = {
    role: session.role,
    company: session.company || '',
    mcq_topics: (byRound[1]?.payload?.topic_scores || []).map((t) => ({ section: t.section, score: t.score })),
    gd: gd && {
      topic: gd.payload.topic || '',
      parameter_scores: gd.parameter_scores,
      metrics: gd.payload.metrics,
      student_turns: (gd.payload.transcript || []).filter((t) => t.is_student).map((t) => clip(t.text, 300)).slice(0, 12),
    },
    hr: hr && {
      parameter_scores: hr.parameter_scores,
      pairs: (hr.payload.pairs || []).slice(0, 10).map((p) => ({ question: clip(p.question, 200), answer: clip(p.answer, 400), score: p.score })),
    },
  };
  return aiClient.callAiService('/v1/interview/final-report', body);
}

async function build(session, rounds) {
  const [user, student] = await Promise.all([
    userRepository.findById(session.user_id).catch(() => null),
    studentRepository.findById(session.student_id).catch(() => null),
  ]);
  const base = rulesReport({ session, rounds, student, user });
  try {
    return mergeAi(base, await aiEnrichment(base, rounds, session));
  } catch (err) {
    logger.warn('Final report: AI enrichment unavailable, using rules-based report', { error: err.message });
    return base;
  }
}

module.exports = { build, rulesReport, mergeAi, GD_LABELS, HR_LABELS };
