const { BrevoClient, BrevoError } = require('@getbrevo/brevo');
const env = require('../config/env');
const logger = require('../utils/logger');
const { isEmailConfigured } = require('./email.service');

let client = null;
function getClient() {
  if (!client) client = new BrevoClient({ apiKey: env.brevo.apiKey });
  return client;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_RETRY_AFTER_MS = 60 * 1000;

function isTemplateConfigured(templateId) {
  return isEmailConfigured() && templateId > 0;
}

// Brevo sends rate-limit info on every response; on a 429 honour Retry-After
// (seconds) if present, falling back to the exponential delay.
function retryAfterMs(err) {
  const headers = err.rawResponse?.headers;
  const raw = headers?.get ? headers.get('retry-after') : headers?.['retry-after'];
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : null;
}

// 429, 5xx and network errors (no status) are worth retrying; any other 4xx
// is a problem with the request itself and would fail identically next time.
function isRetryable(err) {
  const status = err.statusCode;
  return status === undefined || status === 429 || status >= 500;
}

function describe(err) {
  // Never log the raw SDK error — it can carry the request headers (API key).
  return err instanceof BrevoError ? `Brevo API error ${err.statusCode}: ${err.message}` : err.message;
}

// One POST /smtp/email call with retries. Resolves to { messageIds } or throws
// the last error once attempts are exhausted.
async function postBatch(items, { templateId, tag, sleep, retryBaseMs, maxAttempts }) {
  const request = {
    sender: { email: env.brevo.senderEmail, name: env.brevo.senderName || 'TalentSnaps' },
    templateId,
    tags: [tag],
    messageVersions: items.map(({ email, name, params }) => ({ to: [{ email, name }], params })),
  };

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await getClient().transactionalEmails.sendTransacEmail(request);
      return { messageIds: res?.messageIds || [] };
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts) break;
      const delay = (err.statusCode === 429 && retryAfterMs(err)) || retryBaseMs * 2 ** (attempt - 1);
      logger.warn('Brevo send failed, retrying', { tag, attempt, delayMs: delay, error: describe(err) });
      await sleep(delay);
    }
  }
  throw lastErr;
}

// Sends one batch; on a 400 (a single bad recipient/params rejects the whole
// request) splits in half to isolate the offender so the rest still go out.
async function sendBatch(items, opts, results) {
  try {
    const { messageIds } = await postBatch(items, opts);
    // messageIds line up with messageVersions order; if Brevo ever returns a
    // different count, record success without per-recipient ids.
    const aligned = messageIds.length === items.length;
    items.forEach((item, i) => results.push({ key: item.key, ok: true, messageId: aligned ? messageIds[i] : null }));
  } catch (err) {
    if (err.statusCode === 400 && items.length > 1) {
      const mid = Math.ceil(items.length / 2);
      await sendBatch(items.slice(0, mid), opts, results);
      await sendBatch(items.slice(mid), opts, results);
      return;
    }
    const error = describe(err);
    items.forEach((item) => results.push({ key: item.key, ok: false, error }));
  }
}

// The one place every templated notification email goes out from.
//
// items: [{ key, email, name, params }] — `key` is opaque and echoed back so
// callers can match results to their own rows. Returns [{ key, ok, messageId?, error? }]
// for every item; never throws for a send failure.
//
// Each recipient is their own messageVersion (their params differ), batched
// env.brevo.batchSize versions per API call, with a pause between calls to stay
// inside Brevo's request rate limit. `tag` shows up in Brevo's reporting.
async function sendTemplatedEmails(items, { templateId, tag, sleep = defaultSleep, retryBaseMs = 1000 }) {
  if (items.length === 0) return [];
  if (!isTemplateConfigured(templateId)) {
    const error = `Brevo is not configured (BREVO_API_KEY, BREVO_SENDER_EMAIL and the "${tag}" template id)`;
    logger.warn('Notification emails not sent', { tag, count: items.length, reason: error });
    return items.map((item) => ({ key: item.key, ok: false, error }));
  }

  const opts = { templateId, tag, sleep, retryBaseMs, maxAttempts: env.brevo.maxAttempts };
  const results = [];
  for (let i = 0; i < items.length; i += env.brevo.batchSize) {
    if (i > 0) await sleep(env.brevo.minRequestIntervalMs);
    await sendBatch(items.slice(i, i + env.brevo.batchSize), opts, results);
  }
  return results;
}

module.exports = { sendTemplatedEmails, isTemplateConfigured };
