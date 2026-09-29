const Joi = require('joi');

// Public "Talk to Sales" form on the marketing site (frontend
// src/app/talk-to-sales). Values end up in an email to the sales inbox, so
// every field is length-capped.
const PRODUCTS = ['campus_placements', 'recruiter_hiring', 'student_assessments', 'other'];

const salesRequest = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  organization: Joi.string().trim().min(2).max(160).required(),
  email: Joi.string().trim().email().max(255).required(),
  phone: Joi.string().trim().pattern(/^[+0-9 ()-]{7,20}$/).required()
    .messages({ 'string.pattern.base': 'Enter a valid phone number' }),
  product: Joi.string().valid(...PRODUCTS).required(),
  message: Joi.string().trim().max(2000).allow(''),
  // Cloudflare Turnstile token from the widget rendered with data-action="talk_to_sales".
  turnstileToken: Joi.string().max(2048).required(),
});

module.exports = { salesRequest, PRODUCTS };
