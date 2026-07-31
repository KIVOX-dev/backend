const Joi = require('joi');

const create = Joi.object({
  user_id: Joi.string().uuid().required(),
  institution_id: Joi.string().uuid().required(),
  department_id: Joi.string().uuid().allow(null),
  roll_number: Joi.string().max(50).required(),
  batch_year: Joi.number().integer().min(1990).max(2100).required(),
  cgpa: Joi.number().min(0).max(10).allow(null),
  resume_url: Joi.string().uri().allow('', null),
});

const update = Joi.object({
  department_id: Joi.string().uuid().allow(null),
  roll_number: Joi.string().max(50),
  batch_year: Joi.number().integer().min(1990).max(2100),
  cgpa: Joi.number().min(0).max(10).allow(null),
  resume_url: Joi.string().uri().allow('', null),
});

const identify = Joi.object({
  collegeId: Joi.string().max(255),
  collegeName: Joi.string().max(255),
  rollNo: Joi.string().max(50),
  studentId: Joi.string().max(50),
}).or('collegeId', 'collegeName').or('rollNo', 'studentId');

const logTest = Joi.object({
  test_id: Joi.string().uuid().allow(null),
  score: Joi.number().min(0),
  max_score: Joi.number().greater(0),
  total: Joi.number().greater(0),
  percentage: Joi.number().min(0).max(100),
  test_name: Joi.string().max(255),
  title: Joi.string().max(255),
  duration: Joi.number().integer().min(0),
});

const interviewResponse = Joi.object({
  question_id: Joi.number().integer(),
  question_text: Joi.string().max(2000),
  answer_text: Joi.string().max(5000),
  score: Joi.number().min(0),
  rating: Joi.number().min(1).max(10),
  feedback: Joi.string().max(2000),
  time_taken_seconds: Joi.number().integer().min(0),
});

const logInterview = Joi.object({
  role: Joi.string().max(255).required(),
  category: Joi.string().max(50),
  overall_rating: Joi.number().min(0).max(10),
  strengths: Joi.array().items(Joi.string().max(255)),
  improvements: Joi.array().items(Joi.string().max(255)),
  duration_seconds: Joi.number().integer().min(0),
  responses: Joi.array().items(interviewResponse),
});

const batchStudent = Joi.object({
  email: Joi.string().email(),
  roll: Joi.string().max(50),
  studentId: Joi.string().max(50),
  name: Joi.string().max(255).required(),
  password: Joi.string().min(8).max(128),
  department: Joi.string().max(255),
  department_id: Joi.string().uuid(),
  year: Joi.number().integer(),
}).or('roll', 'studentId');

const batchCreate = Joi.object({
  students: Joi.array().items(batchStudent).min(1).required(),
  department: Joi.string().max(255),
  department_id: Joi.string().uuid(),
  year: Joi.number().integer(),
});

module.exports = { create, update, identify, logTest, logInterview, batchCreate };
