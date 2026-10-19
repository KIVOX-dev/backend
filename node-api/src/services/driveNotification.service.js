const emailNotificationService = require('./emailNotification.service');
const studentRepository = require('../repositories/student.repository');
const departmentRepository = require('../repositories/department.repository');
const { isDriveLive } = require('../utils/driveEmail');

const driveScope = (drive) => ({ entityType: 'drive', entityId: drive.id, eventType: 'drive_assigned', roundNumber: null });

const asList = (value) => (Array.isArray(value) ? value.filter((v) => v !== null && v !== '') : []);

// Placement-drive emails: who gets one, and when. Sending is the generic
// engine's job (emailNotification.service.js).
class DriveNotificationService {
  // Students of the drive's institution who meet its eligibility rules —
  // eligible_departments, eligible_years (batch years) and min_cgpa, the same
  // gates utils/candidateMatching.js#checkEligibility applies for HR. An empty
  // rule means "no restriction". A student with no CGPA on record is not
  // eligible for a drive with a minimum (matches hrMatching's filter).
  // The free-form `eligibility_criteria` object has no fixed shape, so it is
  // not applied.
  async eligibleStudentIds(drive) {
    const filter = { institution_id: drive.institution_id };

    const years = asList(drive.eligible_years).map(Number).filter(Number.isFinite);
    if (years.length) filter.batch_year = { $in: years };
    if (drive.min_cgpa) filter.cgpa = { $gte: Number(drive.min_cgpa) };

    const wanted = asList(drive.eligible_departments).map((d) => String(d).trim().toLowerCase());
    if (wanted.length) {
      const { rows: departments } = await departmentRepository.findAll({
        page: 1,
        limit: 1000,
        filters: { institution_id: drive.institution_id },
      });
      const ids = departments
        .filter((d) => wanted.includes(String(d.name || '').toLowerCase()) || wanted.includes(String(d.code || '').toLowerCase()))
        .map((d) => d.id);
      if (ids.length === 0) return [];
      filter.department_id = { $in: ids };
    }

    const docs = await studentRepository.collection.find(filter, { projection: { _id: 1 } }).toArray();
    return docs.map((d) => d._id);
  }

  // EVENT 1. Safe to call on every create/update of a live drive: students who
  // already have a drive_assigned row are skipped, so only newly eligible
  // students (e.g. after the admin adds a department or batch) are emailed.
  async notifyDriveAssigned(drive) {
    if (!isDriveLive(drive)) return 0;
    const studentIds = await this.eligibleStudentIds(drive);
    return emailNotificationService.queueRecipients(driveScope(drive), drive.institution_id, studentIds);
  }

  // EVENT 2. Round 1 and plain shortlists (no round) never email — students
  // already got the drive email. One row per student per round, so
  // un-shortlisting and re-shortlisting for the same round never re-sends.
  async notifyRoundShortlisted(drive, roundNumber, studentIds) {
    if (!isDriveLive(drive) || !Number.isInteger(roundNumber) || roundNumber < 2) return 0;
    const scope = { entityType: 'drive', entityId: drive.id, eventType: 'round_shortlisted', roundNumber };
    return emailNotificationService.queueRecipients(scope, drive.institution_id, studentIds);
  }

  getSummary(driveId, filters) {
    return emailNotificationService.getSummary('drive', driveId, filters);
  }

  listFailed(driveId, filters) {
    return emailNotificationService.listFailed('drive', driveId, filters);
  }

  resendFailed(driveId, filters) {
    return emailNotificationService.resendFailed('drive', driveId, filters);
  }
}

module.exports = new DriveNotificationService();
