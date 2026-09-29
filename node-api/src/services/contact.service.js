const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { sendEmail, isEmailConfigured } = require('./email.service');

const PRODUCT_LABELS = {
  campus_placements: 'Campus placements (placement cell)',
  recruiter_hiring: 'Hiring from campus (recruiters)',
  student_assessments: 'Student assessments & skill reports',
  other: 'Something else',
};

// Visitor-supplied text goes into an HTML email; escape all of it.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Emails the request to the sales inbox with Reply-To set to the visitor, so
// the team answers straight from their inbox. Nothing is stored.
async function submitSalesRequest({ name, organization, email, phone, product, message }) {
  if (!isEmailConfigured()) {
    throw ApiError.serviceUnavailable(`We couldn't send your request right now. Please email ${env.contact.salesInbox}.`);
  }

  const productLabel = PRODUCT_LABELS[product] || product;
  const rows = [
    ['Name', name],
    ['Organization', organization],
    ['Work email', email],
    ['Phone', phone],
    ['Interested in', productLabel],
    ['Message', message || '—'],
  ];

  const result = await sendEmail({
    to: env.contact.salesInbox,
    replyTo: email,
    subject: `Talk to Sales: ${organization} (${name})`,
    html: `<h2 style="font-family:sans-serif">New Talk to Sales request</h2>
<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">
${rows.map(([k, v]) => `<tr><td style="padding:6px 16px 6px 0;color:#666;vertical-align:top">${k}</td><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`).join('\n')}
</table>
<p style="font-family:sans-serif;font-size:13px;color:#666">Reply to this email to answer ${escapeHtml(name)} directly.</p>`,
    text: `New Talk to Sales request\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nReply to this email to answer ${name} directly.`,
  });

  if (!result.sent) {
    logger.error('Talk to Sales request not delivered', { reason: result.reason });
    throw ApiError.serviceUnavailable(`We couldn't send your request right now. Please email ${env.contact.salesInbox}.`);
  }

  // Acknowledgement to the visitor. Best-effort: the request already reached
  // the sales team, so a failure here must not fail the submission.
  try {
    const ack = await sendEmail({
      to: email,
      subject: 'Thank you for contacting TalentSnaps',
      html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#222">
<p>Hi ${escapeHtml(name)},</p>
<p>Thank you for contacting TalentSnaps. You'll receive a return call, or our team will contact you soon.</p>
<p>If it's urgent, write to us at <a href="mailto:${escapeHtml(env.contact.salesInbox)}">${escapeHtml(env.contact.salesInbox)}</a>.</p>
<p>Regards,<br>Team TalentSnaps</p>
</div>`,
      text: `Hi ${name},\n\nThank you for contacting TalentSnaps. You'll receive a return call, or our team will contact you soon.\n\nIf it's urgent, write to us at ${env.contact.salesInbox}.\n\nRegards,\nTeam TalentSnaps`,
    });
    if (!ack.sent) logger.warn('Talk to Sales acknowledgement not delivered', { reason: ack.reason });
  } catch (err) {
    logger.warn('Talk to Sales acknowledgement failed', { error: err.message });
  }
}

module.exports = { submitSalesRequest, PRODUCT_LABELS };
