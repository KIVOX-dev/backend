const env = require('../config/env');
const logger = require('../utils/logger');
const notificationRepository = require('../repositories/emailNotification.repository');
const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const departmentRepository = require('../repositories/department.repository');
const { sendTemplatedEmails } = require('./brevoBatchEmail.service');
const { getHandler } = require('./notificationHandlers');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Required lazily: the queue module loads this service back to run jobs.
const queue = () => require('../queues/emailNotification.queue');

// The generic engine behind every notification email. Domain services
// (testNotification, driveNotification) decide *who* to email and *when*;
// this records them, queues the job, and — in the worker — sends.
class EmailNotificationService {
  // Records a `queued` row per student not already notified for this scope
  // (the idempotency check) and enqueues the send. Returns how many students
  // will be emailed.
  async queueRecipients(scope, institutionId, studentIds) {
    const newIds = await notificationRepository.insertQueued(scope, institutionId, studentIds);
    if (newIds.length > 0) await queue().enqueue(scope);
    return newIds.length;
  }

  getSummary(entityType, entityId, filters) {
    return notificationRepository.summarize(entityType, entityId, filters);
  }

  listFailed(entityType, entityId, filters) {
    return notificationRepository.listFailed(entityType, entityId, filters);
  }

  // Re-queues failed rows only (optionally one event / one round). `sent`
  // rows are never touched, so a resend cannot duplicate an email.
  async resendFailed(entityType, entityId, filters) {
    const { requeued, scopes } = await notificationRepository.resetFailed(entityType, entityId, filters);
    for (const scope of scopes) await queue().enqueue(scope);
    return { requeued };
  }

  // Worker entry point: drains every sendable row for a scope, a Brevo batch
  // at a time. Safe to run concurrently or repeatedly — rows are claimed
  // atomically and `sent` rows are never touched again.
  async processScope(scope, { sleep } = {}) {
    const handler = getHandler(scope.eventType);
    const ctx = handler ? await handler.load(scope) : null;
    if (!ctx) {
      logger.info('Skipping notification emails: entity missing or not deliverable', scope);
      return { sent: 0, failed: 0 };
    }

    const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const totals = { sent: 0, failed: 0 };
    let first = true;
    for (;;) {
      const rows = await notificationRepository.claimBatch(scope, env.brevo.batchSize);
      if (rows.length === 0) break;
      if (!first) await wait(env.brevo.minRequestIntervalMs);
      first = false;
      const batch = await this.#sendRows(handler, ctx, scope, rows, sleep ? { sleep } : {});
      totals.sent += batch.sent;
      totals.failed += batch.failed;
    }
    logger.info('Notification emails processed', { ...scope, ...totals });
    return totals;
  }

  async #sendRows(handler, ctx, scope, rows, sendOptions) {
    const students = await studentRepository.findByIds(rows.map((r) => r.student_id));
    const studentById = new Map(students.map((s) => [s.id, s]));
    const users = await userRepository.findByIds(students.map((s) => s.user_id));
    const userById = new Map(users.map((u) => [u.id, u]));
    const departments = await departmentRepository.findByIds(students.map((s) => s.department_id));
    const departmentById = new Map(departments.map((d) => [d.id, d]));

    const outcome = { sent: 0, failed: 0 };
    const items = [];
    const rowByKey = new Map();
    const fail = async (row, email, error) => {
      logger.warn('Notification email skipped', { ...scope, studentId: row.student_id, reason: error });
      await notificationRepository.markFailed(row.id, { email, error });
      outcome.failed += 1;
    };

    for (const row of rows) {
      const student = studentById.get(row.student_id);
      const user = student ? userById.get(student.user_id) : null;
      const email = user?.email?.trim();
      if (!user) { await fail(row, null, 'Skipped: student or user record not found'); continue; }
      if (user.is_active === false) { await fail(row, email, 'Skipped: user account is inactive'); continue; }
      if (!email || !EMAIL_RE.test(email)) { await fail(row, email, 'Skipped: missing or invalid email address'); continue; }

      rowByKey.set(row.id, { row, email });
      items.push({
        key: row.id,
        email,
        name: user.full_name || undefined,
        params: {
          ...ctx.params,
          ...handler.rowParams(ctx, { student, user, department: departmentById.get(student.department_id) }),
        },
      });
    }

    const results = await sendTemplatedEmails(items, {
      templateId: env.brevo.templates[handler.eventType],
      tag: handler.eventType,
      ...sendOptions,
    });
    for (const result of results) {
      const { row, email } = rowByKey.get(result.key);
      if (result.ok) {
        await notificationRepository.markSent(row.id, { email, messageId: result.messageId });
        outcome.sent += 1;
      } else {
        await notificationRepository.markFailed(row.id, { email, error: result.error });
        outcome.failed += 1;
      }
    }
    return outcome;
  }
}

module.exports = new EmailNotificationService();
