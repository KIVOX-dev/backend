const studentRepository = require('../repositories/student.repository');
const departmentRepository = require('../repositories/department.repository');
const institutionRepository = require('../repositories/institution.repository');
const userRepository = require('../repositories/user.repository');
const ApiError = require('../utils/ApiError');

// Self-service "complete my student profile" flow — distinct from the
// existing admin-provisioned /students CRUD (which requires
// super_admin/institution_admin/faculty and creates a row on someone else's
// behalf). This is a student setting up their OWN row after signing in
// (typically via Google OAuth, before they've picked a college at all), so
// it deliberately does not go through scopeInstitution — that middleware
// would force institution_id to the caller's *current* institution, which
// is exactly what doesn't exist yet at this point.
class StudentProfileService {
  async getOwn(actor) {
    const profile = await studentRepository.findByUserId(actor.id);
    if (!profile) throw ApiError.notFound('Profile not created yet');
    return profile;
  }

  async createOwn(actor, data) {
    const existing = await studentRepository.findByUserId(actor.id);
    if (existing) throw ApiError.conflict('Profile already exists — use PUT to update it');

    await this._validateCollegeDepartment(data.collegeId, data.departmentId);
    await this._assertRollNumberAvailable(data.collegeId, data.rollNumber);

    const profile = await studentRepository.create({
      user_id: actor.id,
      institution_id: data.collegeId,
      department_id: data.departmentId,
      roll_number: data.rollNumber,
      year_of_study: data.year,
      semester: data.semester,
      section: data.section,
      phone: data.phone,
      date_of_birth: data.dateOfBirth,
      gender: data.gender,
      address: data.address,
      profile_completed: true,
    });

    // Keeps the user record's institution_id in sync, since every other
    // institution-scoped endpoint (tests, placements, achievements, ...)
    // reads it from there (and from the JWT, issued from that same field —
    // note the student's *current* access token was minted before this
    // college was chosen, so institution-scoped features won't see it until
    // they log in again or the token is refreshed).
    await userRepository.updateById(actor.id, { institution_id: data.collegeId });

    return profile;
  }

  async updateOwn(actor, data) {
    const existing = await studentRepository.findByUserId(actor.id);
    if (!existing) throw ApiError.notFound('Profile not found — create it first');

    const collegeId = data.collegeId || existing.institution_id;
    const departmentId = data.departmentId || existing.department_id;
    if (data.collegeId || data.departmentId) {
      await this._validateCollegeDepartment(collegeId, departmentId);
    }
    if (data.rollNumber && data.rollNumber !== existing.roll_number) {
      await this._assertRollNumberAvailable(collegeId, data.rollNumber, existing.id);
    }

    const payload = {};
    if (data.collegeId) payload.institution_id = data.collegeId;
    if (data.departmentId) payload.department_id = data.departmentId;
    if (data.rollNumber) payload.roll_number = data.rollNumber;
    if (data.year != null) payload.year_of_study = data.year;
    if (data.semester != null) payload.semester = data.semester;
    if (data.section) payload.section = data.section;
    if (data.phone) payload.phone = data.phone;
    if (data.dateOfBirth) payload.date_of_birth = data.dateOfBirth;
    if (data.gender) payload.gender = data.gender;
    if (data.address) payload.address = data.address;

    const updated = await studentRepository.updateById(existing.id, payload);
    if (data.collegeId) await userRepository.updateById(actor.id, { institution_id: data.collegeId });
    return updated;
  }

  async _validateCollegeDepartment(collegeId, departmentId) {
    const college = await institutionRepository.findById(collegeId);
    if (!college) throw ApiError.badRequest('Selected college does not exist');

    const department = await departmentRepository.findById(departmentId);
    if (!department) throw ApiError.badRequest('Selected department does not exist');
    if (department.institution_id !== collegeId) {
      throw ApiError.badRequest('Selected department does not belong to the selected college');
    }
  }

  async _assertRollNumberAvailable(collegeId, rollNumber, excludeStudentId) {
    const clash = await studentRepository.findOne({ institution_id: collegeId, roll_number: rollNumber });
    if (clash && clash.id !== excludeStudentId) {
      throw ApiError.conflict('This roll number is already in use at the selected college');
    }
  }
}

module.exports = new StudentProfileService();
