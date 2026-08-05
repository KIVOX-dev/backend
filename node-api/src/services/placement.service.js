const BaseService = require('./BaseService');
const placementRepository = require('../repositories/placement.repository');
const placementApplicationRepository = require('../repositories/placementApplication.repository');
const hrRepository = require('../repositories/hr.repository');
const companyRepository = require('../repositories/company.repository');
const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');

class PlacementService extends BaseService {
  constructor() {
    super(placementRepository, { entityName: 'Placement' });
  }

  // created_by/recruiter_id are always the authenticated caller — never trust
  // a client-supplied value here. institution_admin cannot post a drive under
  // a different institution than their own (ported from python-service's
  // jobs.py, same rule, same reasoning).
  async create(data, actor) {
    if (![ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.HR].includes(actor.role)) {
      throw ApiError.forbidden('Not authorized to post placements');
    }

    const payload = { ...data, created_by: actor.id };

    if (actor.role === ROLES.INSTITUTION_ADMIN) {
      payload.institution_id = actor.institutionId;
    } else if (actor.role === ROLES.HR) {
      payload.recruiter_id = actor.id;
      if (!payload.company_name) {
        const hrProfile = await hrRepository.findByUserId(actor.id);
        const company = hrProfile ? await companyRepository.findById(hrProfile.company_id) : null;
        if (company) {
          payload.company_name = company.name;
          payload.company_id = payload.company_id || company.id;
        }
      }
    }

    return this.repository.create(payload);
  }

  // A recruiter/HR's own postings. Frontend (hr/page.tsx) renders this as a
  // plain array with no pagination UI, so this intentionally returns
  // everything rather than a default-sized page — `total` is still the real
  // countDocuments result (not rows.length), so a caller with >1000
  // postings is at least visible via `total` even though `rows` caps there;
  // see placement.controller.js for how that's surfaced without changing
  // the array response body shape the frontend already depends on.
  async listMine(actor) {
    const { rows, meta } = await super.list({ limit: 1000 }, { recruiter_id: actor.id });
    return { rows, total: meta.total };
  }

  // Institution-scoped postings with an applicant count per posting — backs
  // the college-admin placements dashboard. Ported from python-service's
  // GET /jobs/drives.
  async listDrives(actor) {
    const extraFilters = actor.role === ROLES.SUPER_ADMIN ? {} : { institution_id: actor.institutionId };
    const { rows: postings, meta } = await super.list({ limit: 1000 }, extraFilters);
    if (postings.length === 0) return { rows: [], total: meta.total };

    const counts = await placementApplicationRepository.countByPlacementIds(postings.map((p) => p.id));
    const rows = postings.map((p) => ({
      id: p.id,
      title: p.title,
      company_name: p.company_name,
      location: p.location,
      job_type: p.job_type,
      status: p.status,
      application_deadline: p.application_deadline,
      created_at: p.created_at,
      applicant_count: counts[p.id] || 0,
    }));
    return { rows, total: meta.total };
  }

  // All applications across the caller's own postings, with student name/email
  // and job title joined in. Ported from python-service's GET /jobs/applications/me
  // (including its N+1-per-student lookup pattern — not aggregated there either).
  async listApplicationsForRecruiter(actor) {
    if (![ROLES.HR, ROLES.SUPER_ADMIN].includes(actor.role)) {
      throw ApiError.forbidden('Only recruiters may view applications');
    }
    const { rows: postings } = await super.list({ limit: 1000 }, { recruiter_id: actor.id });
    if (postings.length === 0) return [];

    const titleById = Object.fromEntries(postings.map((p) => [p.id, p.title]));
    const applications = await placementApplicationRepository.findByPlacementIds(postings.map((p) => p.id));

    return Promise.all(
      applications.map(async (app) => {
        const student = await studentRepository.findById(app.student_id);
        const user = student ? await userRepository.findById(student.user_id) : null;
        return {
          id: app.id,
          placement_id: app.placement_id,
          student_id: app.student_id,
          status: app.status,
          created_at: app.created_at,
          updated_at: app.updated_at,
          student_name: user ? user.full_name : null,
          student_email: user ? user.email : null,
          job_title: titleById[app.placement_id] || null,
        };
      })
    );
  }
}

module.exports = new PlacementService();
