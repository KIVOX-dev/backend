const env = require('../../config/env');
const testRepository = require('../../repositories/test.repository');
const { formatIstDateTime } = require('../../utils/istFormat');

// Handler contract (see emailNotification.service.js#processScope):
//   load(scope)                -> context for this send, or null when the
//                                 entity can't be emailed about right now
//   rowParams(ctx, recipient)  -> params specific to one student
// ctx.params are the params every recipient shares.
module.exports = {
  entityType: 'test',
  eventType: 'test_assigned',
  async load(scope) {
    const test = await testRepository.findById(scope.entityId);
    if (!test || test.status !== 'active') return null;
    return {
      params: {
        assessmentTitle: test.title,
        startDateTime: formatIstDateTime(test.start_at, 'Available now'),
        endDateTime: formatIstDateTime(test.end_at, 'No end date'),
        durationMinutes: test.duration_minutes,
        testLink: `${env.frontendUrl.replace(/\/$/, '')}${env.notifications.testLinkPath}`,
      },
    };
  },
  rowParams(ctx, { student, user, department }) {
    return {
      studentName: user.full_name || 'Student',
      departmentName: department?.name || '',
      batchName: student.batch_year ? `Batch ${student.batch_year}` : '',
    };
  },
};
