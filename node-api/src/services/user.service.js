const BaseService = require('./BaseService');
const userRepository = require('../repositories/user.repository');
const { hashPassword } = require('../utils/password');
const { ROLES } = require('../config/constants');
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

  async list(queryParams, extraFilters) {
    const { rows, meta } = await super.list(queryParams, extraFilters);
    return { rows: rows.map(sanitize), meta };
  }

  async getById(id) {
    return sanitize(await super.getById(id));
  }

  // `actor` is the authenticated caller (req.user). Institution admins may only
  // provision HR/faculty/student accounts, and only within their own institution —
  // this is what stops a compromised institution_admin token from minting a super_admin.
  async create(data, actor) {
    if (!data.password) throw ApiError.badRequest('password is required');

    const payload = { ...data };
    if (actor && actor.role === ROLES.INSTITUTION_ADMIN) {
      if (![ROLES.HR, ROLES.FACULTY, ROLES.STUDENT].includes(payload.role)) {
        throw ApiError.forbidden('Institution admins may only create HR, faculty, or student accounts');
      }
      payload.institution_id = actor.institutionId;
    }

    payload.password_hash = await hashPassword(payload.password);
    delete payload.password;

    const user = await this.repository.create(payload);
    return sanitize(user);
  }

  async update(id, data, actor) {
    const payload = { ...data };
    if (actor && actor.role === ROLES.INSTITUTION_ADMIN) {
      delete payload.role;
      delete payload.institution_id;
    }
    if (payload.password) {
      payload.password_hash = await hashPassword(payload.password);
      delete payload.password;
    }
    return sanitize(await super.update(id, payload));
  }
}

module.exports = new UserService();
