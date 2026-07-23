const userRepository = require('../repositories/user.repository');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { verifyGoogleIdToken } = require('../utils/googleAuth');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const recordActivity = require('../utils/recordActivity');

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}

function issueTokens(user) {
  const payload = { sub: user.id, role: user.role, institutionId: user.institution_id };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

// Public self-service registration always creates a STUDENT account.
// Institution admins, HR, and faculty accounts are provisioned by a super_admin/institution_admin
// through the dedicated /users (or /students, /faculty, /hr) endpoints, never through open registration.
async function register({ email, password, fullName, phone, institutionId }) {
  const existing = await userRepository.findByEmail(email);
  if (existing) throw ApiError.conflict('An account with this email already exists');

  const passwordHash = await hashPassword(password);
  const user = await userRepository.create({
    email,
    password_hash: passwordHash,
    full_name: fullName,
    phone,
    role: ROLES.STUDENT,
    institution_id: institutionId || null,
  });

  await recordActivity({ userId: user.id, action: 'register', entityType: 'user', entityId: user.id });
  return { user: sanitizeUser(user), ...issueTokens(user) };
}

async function login({ email, password }) {
  const user = await userRepository.findByEmail(email);
  if (!user || !user.is_active) throw ApiError.unauthorized('Invalid email or password');

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) throw ApiError.unauthorized('Invalid email or password');

  await userRepository.updateById(user.id, { last_login_at: new Date() });
  await recordActivity({ userId: user.id, action: 'login', entityType: 'user', entityId: user.id });
  return { user: sanitizeUser(user), ...issueTokens(user) };
}

async function googleLogin(idToken) {
  const profile = await verifyGoogleIdToken(idToken);

  let user = await userRepository.findByGoogleId(profile.googleId);
  if (!user) {
    user = await userRepository.findByEmail(profile.email);
    if (user) {
      user = await userRepository.updateById(user.id, { google_id: profile.googleId });
    } else {
      user = await userRepository.create({
        email: profile.email,
        google_id: profile.googleId,
        full_name: profile.fullName,
        role: ROLES.STUDENT,
      });
    }
  }

  if (!user.is_active) throw ApiError.unauthorized('This account has been deactivated');

  await userRepository.updateById(user.id, { last_login_at: new Date() });
  await recordActivity({ userId: user.id, action: 'google_login', entityType: 'user', entityId: user.id });
  return { user: sanitizeUser(user), ...issueTokens(user) };
}

async function refresh(refreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const user = await userRepository.findById(payload.sub);
  if (!user || !user.is_active) throw ApiError.unauthorized('Account no longer active');

  return issueTokens(user);
}

async function me(userId) {
  const user = await userRepository.findById(userId);
  if (!user) throw ApiError.notFound('User not found');
  return sanitizeUser(user);
}

module.exports = { register, login, googleLogin, refresh, me, sanitizeUser };
