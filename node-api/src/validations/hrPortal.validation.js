const Joi = require('joi');
const { ALL_STATUSES } = require('../utils/hrPipeline');

const id = Joi.string().uuid();
const date = Joi.date().iso();
const tags = Joi.array().items(Joi.string().trim().max(60)).max(30);

// ---- pipeline ----
const moveStage = Joi.object({
  status: Joi.string().valid(...ALL_STATUSES.filter((s) => s !== 'withdrawn')).required(),
  note: Joi.string().max(2000).allow('', null),
  reason: Joi.string().max(300).allow('', null),
  // Only read when status = hired: seeds the new employee record.
  hire: Joi.object({
    join_date: date,
    designation: Joi.string().max(150),
    department: Joi.string().max(100),
    employment_type: Joi.string().valid('full_time', 'part_time', 'contract', 'internship'),
    location: Joi.string().max(150),
    manager_name: Joi.string().max(150),
  }),
});

const bulkMove = Joi.object({
  application_ids: Joi.array().items(id).min(1).max(200).required(),
  status: Joi.string().valid(...ALL_STATUSES.filter((s) => s !== 'withdrawn')).required(),
  note: Joi.string().max(2000).allow('', null),
  reason: Joi.string().max(300).allow('', null),
});

const note = Joi.object({ note: Joi.string().min(1).max(2000).required() });

// ---- interviews ----
const interviewer = Joi.object({
  user_id: id,
  name: Joi.string().max(150),
  email: Joi.string().email({ tlds: { allow: false } }).max(255),
}).or('user_id', 'name');

const scheduleInterview = Joi.object({
  application_id: id.required(),
  scheduled_at: date.required(),
  duration_minutes: Joi.number().integer().min(5).max(480),
  round: Joi.number().integer().min(1).max(20),
  title: Joi.string().max(200),
  mode: Joi.string().valid('online', 'onsite', 'phone'),
  location: Joi.string().max(300).allow('', null),
  meeting_link: Joi.string().uri().max(500).allow('', null),
  interviewers: Joi.array().items(interviewer).max(15),
  notes: Joi.string().max(2000).allow('', null),
  force: Joi.boolean(),
});

const rescheduleInterview = Joi.object({
  scheduled_at: date,
  duration_minutes: Joi.number().integer().min(5).max(480),
  title: Joi.string().max(200),
  mode: Joi.string().valid('online', 'onsite', 'phone'),
  location: Joi.string().max(300).allow('', null),
  meeting_link: Joi.string().uri().max(500).allow('', null),
  interviewers: Joi.array().items(interviewer).max(15),
  notes: Joi.string().max(2000).allow('', null),
  reason: Joi.string().max(500),
  force: Joi.boolean(),
}).min(1);

const interviewStatus = Joi.object({
  status: Joi.string().valid('completed', 'cancelled', 'no_show').required(),
  result: Joi.string().valid('pass', 'fail', 'hold'),
  reason: Joi.string().max(500).allow('', null),
});

const interviewFeedback = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required(),
  recommendation: Joi.string().valid('strong_hire', 'hire', 'hold', 'no_hire').required(),
  skill_ratings: Joi.array().items(Joi.object({ skill: Joi.string().max(100).required(), rating: Joi.number().integer().min(1).max(5).required(), comment: Joi.string().max(500).allow('', null) })).max(30),
  strengths: Joi.string().max(2000).allow('', null),
  concerns: Joi.string().max(2000).allow('', null),
  comments: Joi.string().max(4000).allow('', null),
  interviewer_name: Joi.string().max(150),
});

// ---- evaluation ----
const evaluation = Joi.object({
  interview_id: id,
  scores: Joi.array()
    .items(Joi.object({
      name: Joi.string().trim().max(100).required(),
      category: Joi.string().valid('skill', 'technical', 'behavioral').default('skill'),
      rating: Joi.number().min(1).max(5).required(),
      weight: Joi.number().min(0.1).max(10).default(1),
      comment: Joi.string().max(500).allow('', null),
    }))
    .min(1).max(40).required(),
  recommendation: Joi.string().valid('strong_hire', 'hire', 'hold', 'no_hire').required(),
  strengths: Joi.string().max(2000).allow('', null),
  concerns: Joi.string().max(2000).allow('', null),
  notes: Joi.string().max(4000).allow('', null),
});

// ---- talent pool ----
const talentAdd = Joi.object({
  student_id: id,
  application_id: id,
  category: Joi.string().trim().max(80).allow('', null),
  tags,
  skills: tags,
  rating: Joi.number().integer().min(1).max(5).allow(null),
  notes: Joi.string().max(2000).allow('', null),
  source_placement_id: id,
}).xor('student_id', 'application_id');

const talentUpdate = Joi.object({
  category: Joi.string().trim().max(80).allow('', null),
  tags,
  skills: tags,
  rating: Joi.number().integer().min(1).max(5).allow(null),
  notes: Joi.string().max(2000).allow('', null),
  status: Joi.string().valid('active', 'contacted', 'archived'),
}).min(1);

const talentAssign = Joi.object({ placement_id: id.required(), note: Joi.string().max(500).allow('', null) });

// ---- employees ----
const employeeFields = {
  full_name: Joi.string().trim().min(2).max(150),
  email: Joi.string().email({ tlds: { allow: false } }).max(255),
  phone: Joi.string().max(30).allow('', null),
  designation: Joi.string().max(150).allow('', null),
  department: Joi.string().max(100).allow('', null),
  employment_type: Joi.string().valid('full_time', 'part_time', 'contract', 'internship'),
  location: Joi.string().max(150).allow('', null),
  manager_name: Joi.string().max(150).allow('', null),
  join_date: date.allow(null),
  exit_date: date.allow(null),
  status: Joi.string().valid('onboarding', 'active', 'on_notice', 'exited'),
};
const employeeCreate = Joi.object({ ...employeeFields, full_name: employeeFields.full_name.required(), skip_onboarding_template: Joi.boolean() });
const employeeUpdate = Joi.object(employeeFields).min(1);
const hire = Joi.object({
  join_date: date, designation: Joi.string().max(150), department: Joi.string().max(100),
  employment_type: Joi.string().valid('full_time', 'part_time', 'contract', 'internship'), location: Joi.string().max(150), manager_name: Joi.string().max(150),
});

const task = Joi.object({
  title: Joi.string().trim().min(2).max(250).required(),
  category: Joi.string().max(50),
  due_date: date.allow(null),
  assignee: Joi.string().max(150).allow('', null),
});
const taskUpdate = Joi.object({
  title: Joi.string().trim().min(2).max(250),
  category: Joi.string().max(50),
  due_date: date.allow(null),
  assignee: Joi.string().max(150).allow('', null),
  status: Joi.string().valid('pending', 'in_progress', 'done'),
}).min(1);

const skill = Joi.object({ name: Joi.string().trim().min(1).max(100).required(), level: Joi.string().valid('beginner', 'intermediate', 'advanced', 'expert').allow(null) });
const certification = Joi.object({
  name: Joi.string().trim().min(2).max(200).required(),
  issuer: Joi.string().max(200).allow('', null),
  issued_on: date.allow(null),
  expires_on: date.allow(null),
  credential_id: Joi.string().max(200).allow('', null),
  credential_url: Joi.string().uri().max(500).allow('', null),
});

const documentMeta = Joi.object({
  name: Joi.string().trim().max(200),
  type: Joi.string().valid('id_proof', 'address_proof', 'offer_letter', 'contract', 'education', 'experience', 'bank', 'tax', 'other'),
});
const documentVerify = Joi.object({ verified: Joi.boolean().required() });

const review = Joi.object({
  period: Joi.string().trim().min(2).max(60).required(),
  review_date: date,
  reviewer_name: Joi.string().max(150),
  rating: Joi.number().min(1).max(5).required(),
  goals: Joi.array().items(Joi.object({ title: Joi.string().max(300).required(), status: Joi.string().valid('pending', 'in_progress', 'done'), progress: Joi.number().min(0).max(100) })).max(20),
  kpis: Joi.array().items(Joi.object({ name: Joi.string().max(150).required(), target: Joi.number(), actual: Joi.number() })).max(20),
  strengths: Joi.string().max(2000).allow('', null),
  improvements: Joi.string().max(2000).allow('', null),
  comments: Joi.string().max(4000).allow('', null),
});
const goalUpdate = Joi.object({
  title: Joi.string().max(300),
  status: Joi.string().valid('pending', 'in_progress', 'done'),
  progress: Joi.number().min(0).max(100),
}).min(1);

module.exports = {
  moveStage, bulkMove, note,
  scheduleInterview, rescheduleInterview, interviewStatus, interviewFeedback,
  evaluation,
  talentAdd, talentUpdate, talentAssign,
  employeeCreate, employeeUpdate, hire, task, taskUpdate, skill, certification, documentMeta, documentVerify, review, goalUpdate,
};
