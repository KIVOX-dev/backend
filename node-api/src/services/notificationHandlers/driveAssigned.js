const placementRepository = require('../../repositories/placement.repository');
const { isDriveLive, driveAssignedParams } = require('../../utils/driveEmail');

module.exports = {
  entityType: 'drive',
  eventType: 'drive_assigned',
  async load(scope) {
    const placement = await placementRepository.findById(scope.entityId);
    if (!isDriveLive(placement)) return null;
    return { params: driveAssignedParams(placement) };
  },
  rowParams(ctx, { user }) {
    return { studentName: user.full_name || 'Student' };
  },
};
