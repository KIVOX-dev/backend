const placementRepository = require('../../repositories/placement.repository');
const placementRoundRepository = require('../../repositories/placementRound.repository');
const { isDriveLive, commonDriveParams } = require('../../utils/driveEmail');
const { formatIstDateTime } = require('../../utils/istFormat');

// Details are read when the email is sent, not when the student is
// shortlisted — so a round the admin defines a moment after shortlisting is
// still reflected. A round with no details yet sends with those params blank
// (the template hides each block with an {% if %}).
module.exports = {
  entityType: 'drive',
  eventType: 'round_shortlisted',
  async load(scope) {
    const placement = await placementRepository.findById(scope.entityId);
    if (!isDriveLive(placement)) return null;
    const round = await placementRoundRepository.findByPlacementAndNumber(placement.id, scope.roundNumber);
    return {
      params: {
        ...commonDriveParams(placement),
        roundNumber: scope.roundNumber,
        roundName: round?.name || `Round ${scope.roundNumber}`,
        roundDateTime: formatIstDateTime(round?.scheduled_at, ''),
        venueOrLink: round?.venue_or_link || '',
        instructions: round?.instructions || '',
      },
    };
  },
  rowParams(ctx, { user }) {
    return { studentName: user.full_name || 'Student' };
  },
};
