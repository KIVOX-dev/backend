const emailNotificationService = require('./emailNotification.service');
const testAssignmentRepository = require('../repositories/testAssignment.repository');

const scopeFor = (test) => ({ entityType: 'test', entityId: test.id, eventType: 'test_assigned', roundNumber: null });

// Aptitude-test emails: who gets one, and when. Sending is the generic
// engine's job (emailNotification.service.js).
class TestNotificationService {
  // Called after students are assigned a test. A draft test notifies nobody —
  // notifyExistingAssignments() runs when it is activated. Returns how many
  // students will be emailed.
  async notifyAssigned(test, studentIds) {
    if (test.status !== 'active') return 0;
    return emailNotificationService.queueRecipients(scopeFor(test), test.institution_id, studentIds);
  }

  // For a test that has just become `active`: notify everyone assigned to it
  // who hasn't been already.
  async notifyExistingAssignments(test) {
    const docs = await testAssignmentRepository.collection
      .find({ test_id: test.id }, { projection: { student_id: 1 } })
      .toArray();
    return this.notifyAssigned(test, docs.map((d) => d.student_id));
  }

  getSummary(testId) {
    return emailNotificationService.getSummary('test', testId);
  }

  listFailed(testId) {
    return emailNotificationService.listFailed('test', testId);
  }

  resendFailed(test) {
    return emailNotificationService.resendFailed('test', test.id);
  }
}

module.exports = new TestNotificationService();
