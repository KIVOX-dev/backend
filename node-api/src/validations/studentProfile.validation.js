const Joi = require('joi');

const create = Joi.object({
  collegeId: Joi.string().uuid().required(),
  departmentId: Joi.string().uuid().required(),
  rollNumber: Joi.string().min(1).max(50).required(),
  year: Joi.number().integer().min(1).max(6).required(),
  semester: Joi.number().integer().min(1).max(12).required(),
  section: Joi.string().min(1).max(10).required(),
  phone: Joi.string().max(30).allow('', null),
  dateOfBirth: Joi.date().iso().allow(null),
  gender: Joi.string().max(30).allow('', null),
  address: Joi.string().max(1000).allow('', null),
});

// Username pattern shared by all three — permissive enough to cover each
// site's actual rules (LeetCode/HackerRank/Dribbble all allow letters,
// digits, underscore, hyphen) without being site-specific; the real
// existence check happens server-side against the site itself, not here.
const socialUsername = Joi.string().trim().min(1).max(50).pattern(/^[a-zA-Z0-9_-]+$/).allow('', null);

// Career tab: self-reported work history/education, repeatable entries the
// student adds one at a time in the UI but saves as a full replacement array
// (see studentProfile.service.js#updateOwn) — same reasoning as the rest of
// this self-service endpoint: simplest correct thing for a single user
// editing their own profile, no need for per-entry REST endpoints. `id` is
// client-generated (crypto.randomUUID() in the browser) so the frontend can
// target one entry for edit/delete without a server round trip first.
const workExperienceEntry = Joi.object({
  id: Joi.string().required(),
  jobTitle: Joi.string().min(1).max(150).required(),
  companyName: Joi.string().min(1).max(150).required(),
  workMode: Joi.string().valid('remote', 'onsite', 'hybrid').required(),
  workType: Joi.string().valid('internship', 'full_time', 'part_time', 'freelance', 'contract').required(),
  location: Joi.string().max(150).allow('', null),
  startMonth: Joi.number().integer().min(1).max(12).required(),
  startYear: Joi.number().integer().min(1980).max(2100).required(),
  endMonth: Joi.number().integer().min(1).max(12).allow(null),
  endYear: Joi.number().integer().min(1980).max(2100).allow(null),
  isCurrent: Joi.boolean().default(false),
  description: Joi.string().max(2000).allow('', null),
});

const educationEntry = Joi.object({
  id: Joi.string().required(),
  schoolName: Joi.string().min(1).max(150).required(),
  rollNumber: Joi.string().max(50).allow('', null),
  degreeType: Joi.string().min(1).max(100).required(),
  fieldOfStudy: Joi.string().min(1).max(150).required(),
  grade: Joi.string().max(20).allow('', null),
  location: Joi.string().max(150).allow('', null),
  startMonth: Joi.number().integer().min(1).max(12).required(),
  startYear: Joi.number().integer().min(1980).max(2100).required(),
  endMonth: Joi.number().integer().min(1).max(12).allow(null),
  endYear: Joi.number().integer().min(1980).max(2100).allow(null),
});

// Same fields, all optional — a student may update just one field at a time.
const update = Joi.object({
  collegeId: Joi.string().uuid(),
  departmentId: Joi.string().uuid(),
  rollNumber: Joi.string().min(1).max(50),
  year: Joi.number().integer().min(1).max(6),
  semester: Joi.number().integer().min(1).max(12),
  section: Joi.string().min(1).max(10),
  phone: Joi.string().max(30).allow('', null),
  dateOfBirth: Joi.date().iso().allow(null),
  gender: Joi.string().max(30).allow('', null),
  address: Joi.string().max(1000).allow('', null),
  leetcodeUsername: socialUsername,
  hackerrankUsername: socialUsername,
  dribbbleUsername: socialUsername,
  workExperience: Joi.array().items(workExperienceEntry).max(30),
  education: Joi.array().items(educationEntry).max(30),
});

module.exports = { create, update };
