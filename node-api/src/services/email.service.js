const { BrevoClient, BrevoError } = require('@getbrevo/brevo');
const env = require('../config/env');
const logger = require('../utils/logger');

let client = null;

// Not required at boot — a deployment without email configured should still
// run; callers check this and degrade gracefully instead of crashing the request.
function isEmailConfigured() {
  return Boolean(env.brevo.apiKey && env.brevo.senderEmail);
}

function getClient() {
  if (!client) {
    client = new BrevoClient({ apiKey: env.brevo.apiKey });
  }
  return client;
}

// Central send function every templated email goes through. Always supports
// both htmlContent and textContent — the text fallback is what renders in
// email clients/previews that don't (or won't) show HTML, and is required by
// some spam filters as a signal of a legitimate transactional message.
async function sendEmail({ to, subject, html, text }) {
  if (!isEmailConfigured()) {
    logger.warn('Email not sent — Brevo is not configured (BREVO_API_KEY/BREVO_SENDER_EMAIL unset)', {
      to,
      subject,
    });
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const brevo = getClient();
    await brevo.transactionalEmails.sendTransacEmail({
      sender: { email: env.brevo.senderEmail, name: env.brevo.senderName || 'UpScaler-AI' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    });
    logger.info('Email sent', { to, subject });
    return { sent: true };
  } catch (err) {
    // Never log the API key or the raw SDK error object — BrevoError instances
    // can carry the original request (including headers) on `rawResponse`.
    // The message alone is enough to diagnose a failure from the logs.
    const detail = err instanceof BrevoError ? `Brevo API error ${err.statusCode}: ${err.message}` : err.message;
    logger.error('Email failed to send', { to, subject, error: detail });
    return { sent: false, reason: 'send_failed' };
  }
}

module.exports = { isEmailConfigured, sendEmail };
