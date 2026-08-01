const BaseService = require('./BaseService');
const userRepository = require('../repositories/user.repository');
const studentRepository = require('../repositories/student.repository');
const facultyRepository = require('../repositories/faculty.repository');
const hrRepository = require('../repositories/hr.repository');
const { hashPassword } = require('../utils/password');
const { ROLES } = require('../config/constants');
const { assertSameInstitution } = require('../utils/authz');
const ApiError = require('../utils/ApiError');

function sanitize(user) {
  if (!user) return user;
  const { password_hash, ...safe } = user;
  return safe;
}

class UserService extends BaseService {
  constructor() {
    super(userRepository, { entityName: 'User' });
  }

  // Institution-scoped callers never see super_admin accounts, matching
  // python-service's users.py (`query["role"] = {"$ne": "super_admin"}`).
  async list(queryParams, actor) {
    const extraFilters = actor.role === ROLES.SUPER_ADMIN ? {} : { institution_id: actor.institutionId };
    const { rows, meta } = await super.list(queryParams, extraFilters);
    let visible = rows;
    if (actor.role !== ROLES.SUPER_ADMIN) {
      visible = rows.filter((u) => u.role !== ROLES.SUPER_ADMIN);
    }
    return { rows: visible.map(sanitize), meta };
  }

  async listPending(queryParams, actor) {
    const extraFilters = { status: 'pending' };
    if (actor.role !== ROLES.SUPER_ADMIN) extraFilters.institution_id = actor.institutionId;
    const { rows, meta } = await super.list(queryParams, extraFilters);
    const visible = actor.role === ROLES.SUPER_ADMIN ? rows : rows.filter((u) => u.role !== ROLES.SUPER_ADMIN);
    return { rows: visible.map(sanitize), meta };
  }

  async getById(id, actor) {
    return sanitize(await super.getById(id, actor));
  }

  // `actor` is the authenticated caller (req.user). Tiering ported from
  // python-service's users.py create_user: super_admin creates anyone;
  // institution_admin creates hr/faculty/student in their own institution;
  // faculty creates students only, in their own institution.
  async create(data, actor) {
    if (!data.password) throw ApiError.badRequest('password is required');

    const payload = { ...data };
    // student_id/year are python-service's original field names for what
    // node-api's students collection calls roll_number/batch_year — accepted
    // as aliases so callers mid-migration can use either.
    const {
      student_id, year, roll_number, batch_year,
      department_id, company_id, designation,
      ...userFields
    } = payload;
    const resolvedRollNumber = roll_number || student_id;
    const resolvedBatchYear = batch_year || year;

    if (actor.role === ROLES.FACULTY) {
      if (userFields.role !== ROLES.STUDENT) {
        throw ApiError.forbidden('Faculty may only create student accounts');
      }
      userFields.institution_id = actor.institutionId;
    } else if (actor.role === ROLES.INSTITUTION_ADMIN) {
      if (![ROLES.HR, ROLES.FACULTY, ROLES.STUDENT].includes(userFields.role)) {
        throw ApiError.forbidden('Institution admins may only create HR, faculty, or student accounts');
      }
      userFields.institution_id = actor.institutionId;
    } else if (actor.role !== ROLES.SUPER_ADMIN) {
      throw ApiError.forbidden('Not authorized to create users');
    }

    userFields.password_hash = await hashPassword(userFields.password);
    delete userFields.password;

    const user = await this.repository.create(userFields);

    // Cascade-create the role-specific linked row, mirroring python-service's
    // create_user (which auto-creates student_profiles/faculty_profiles/
    // recruiter_profiles alongside the user). python's version only had loose
    // string fields (student_id, year, department); node-api's existing
    // students/faculty/hr collections use real FKs (institution_id,
    // department_id, company_id) — cascaded here only where those FKs are
    // actually supplied, rather than fabricating placeholder linkage python
    // used to (e.g. a fake "New Company" row for every new HR user).
    if (user.role === ROLES.STUDENT && resolvedRollNumber && resolvedBatchYear) {
      await studentRepository.create({
        user_id: user.id,
        institution_id: user.institution_id,
        department_id: department_id || null,
        roll_number: resolvedRollNumber,
        batch_year: resolvedBatchYear,
      });
    } else if (user.role === ROLES.FACULTY && department_id) {
      await facultyRepository.create({
        user_id: user.id,
        institution_id: user.institution_id,
        department_id,
        designation: designation || null,
      });
    } else if (user.role === ROLES.HR && company_id) {
      await hrRepository.create({ user_id: user.id, company_id, designation: designation || null });
    }

    return sanitize(user);
  }

  // Two distinct authorization paths, not one role list: an admin (scoped to
  // their own institution) editing anyone, OR any authenticated user editing
  // their own account (self-service — e.g. Subscription.tsx's "Upgrade to
  // Pro" does PUT /users/:id on the caller's own id to update `preferences`).
  // Route-level authorize(super_admin, institution_admin) used to block that
  // second path entirely, 403ing every self-service update including the
  // student upgrade flow — see H-4.
  async update(id, data, actor) {
    const target = await userRepository.findById(id);
    if (!target) throw ApiError.notFound('User not found');

    const isAdmin = actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.INSTITUTION_ADMIN;
    const isSelf = target.id === actor.id;
    if (!isAdmin && !isSelf) {
      throw ApiError.forbidden('Not authorized');
    }

    let payload = { ...data };
    if (isAdmin) {
      assertSameInstitution(actor, target);
      if (actor.role === ROLES.INSTITUTION_ADMIN) {
        delete payload.role;
        delete payload.institution_id;
      }
    } else {
      // Self-service: whitelisted (not blacklisted) so role, institution_id,
      // status, is_active, is_email_verified — anything privilege- or
      // approval-related — always stays admin-only, even on your own
      // record, and any sensitive field added later is excluded by default.
      const SELF_EDITABLE_FIELDS = ['full_name', 'phone', 'avatar_url', 'preferences', 'password'];
      payload = Object.fromEntries(
        Object.entries(payload).filter(([key]) => SELF_EDITABLE_FIELDS.includes(key))
      );
    }

    if (payload.password) {
      payload.password_hash = await hashPassword(payload.password);
      delete payload.password;
    }
    return sanitize(await super.update(id, payload));
  }

  async remove(id, actor) {
    const target = await userRepository.findById(id);
    if (!target) throw ApiError.notFound('User not found');
    if (actor.role !== ROLES.SUPER_ADMIN && actor.role !== ROLES.INSTITUTION_ADMIN) {
      throw ApiError.forbidden('Not authorized');
    }
    assertSameInstitution(actor, target);
    return super.remove(id);
  }

  // institution_admin may approve/reject pending signups within their own
  // institution (the actual, common case — see InstitutionalApproval.tsx,
  // rendered on the institution-admin portal, not a super_admin-only
  // screen); route used to be super_admin-only, 403ing every institution
  // admin's approval, which is the H-3 "blocks valid Institution Admin
  // operations" bug. super_admin accounts can never legitimately be
  // pending here (self-registration never creates one — see
  // authService.js#SELF_REGISTERABLE_ROLES) but the check stays as
  // defense-in-depth against a role an institution_admin should never touch.
  async assertCanReview(id, actor) {
    const target = await userRepository.findById(id);
    if (!target) throw ApiError.notFound('User not found');
    if (actor.role === ROLES.SUPER_ADMIN) return target;
    if (actor.role !== ROLES.INSTITUTION_ADMIN || target.role === ROLES.SUPER_ADMIN) {
      throw ApiError.forbidden('Not authorized');
    }
    assertSameInstitution(actor, target);
    return target;
  }

  async approve(id, actor) {
    await this.assertCanReview(id, actor);
    return sanitize(await super.update(id, { status: 'approved' }));
  }

  async reject(id, actor) {
    await this.assertCanReview(id, actor);
    return sanitize(await super.update(id, { status: 'rejected' }));
  }
}

module.exports = new UserService();
