const emailNotificationService = require('./emailNotification.service');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { ROLES } = require('../config/constants');

// Roster uploads without a real email get a placeholder address
// (utils/studentOnboarding.js); there is nobody to send those to.
const SYNTHETIC_EMAIL_DOMAIN = '@upscaler-ai.local';

const scopeFor = (institutionId) => ({
  entityType: 'institution',
  entityId: institutionId,
  eventType: 'account_created',
  roundNumber: null,
});

// "Your account is ready" emails for newly onboarded students: who gets one,
// and when. Sending is the generic engine's job (emailNotification.service.js).
class OnboardingNotificationService {
  isSyntheticEmail(email) {
    return String(email || '').toLowerCase().endsWith(SYNTHETIC_EMAIL_DOMAIN);
  }

  // `students`: [{ studentId, usesDefaultPassword }] — only students created in
  // this request. Called once per upload/creation so a 500-row roster is one
  // queued job, not 500. The accounts are already saved by the time this runs,
  // so an email problem must never fail onboarding — rows are recorded first
  // and can be resent. Returns how many students will be emailed.
  async notifyAccountCreated(institutionId, students) {
    if (!institutionId || students.length === 0) return 0;
    try {
      const withDefault = students.filter((s) => s.usesDefaultPassword).map((s) => s.studentId);
      const withCustom = students.filter((s) => !s.usesDefaultPassword).map((s) => s.studentId);
      const scope = scopeFor(institutionId);
      const counts = await Promise.all([
        emailNotificationService.queueRecipients(scope, institutionId, withDefault, { uses_default_password: true }),
        emailNotificationService.queueRecipients(scope, institutionId, withCustom, { uses_default_password: false }),
      ]);
      return counts[0] + counts[1];
    } catch (err) {
      logger.error('Could not queue account-created emails', { institutionId, error: err.message });
      return 0;
    }
  }

  // Staff are confined to their own institution; a super admin names one.
  #institutionFor(actor, requested) {
    // Only a plain string ever reaches a query — never a client-supplied object.
    const institutionId = actor.role === ROLES.SUPER_ADMIN && typeof requested === 'string' ? requested : actor.institutionId;
    if (!institutionId) throw ApiError.badRequest('institution_id is required', null, 'VALIDATION_ERROR');
    return institutionId;
  }

  async getSummary(actor, requestedInstitutionId) {
    const institutionId = this.#institutionFor(actor, requestedInstitutionId);
    const [summary, failedRecipients] = await Promise.all([
      emailNotificationService.getSummary('institution', institutionId, { eventType: 'account_created' }),
      emailNotificationService.listFailed('institution', institutionId, { eventType: 'account_created' }),
    ]);
    return { ...summary, failed_recipients: failedRecipients };
  }

  // Re-queues failed rows only; students already emailed are never re-sent.
  resendFailed(actor, requestedInstitutionId) {
    const institutionId = this.#institutionFor(actor, requestedInstitutionId);
    return emailNotificationService.resendFailed('institution', institutionId, { eventType: 'account_created' });
  }
}

module.exports = new OnboardingNotificationService();
