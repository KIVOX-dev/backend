const userRepository = require('../repositories/user.repository');
const institutionRepository = require('../repositories/institution.repository');
const studentRepository = require('../repositories/student.repository');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { verifyGoogleIdToken } = require('../utils/googleAuth');
const { generateRawToken, hashToken } = require('../utils/token');
const { sendEmail } = require('./email.service');
const { passwordResetTemplate, verificationTemplate } = require('./emailTemplates');
const { ROLES } = require('../config/constants');
const { mapPythonRole } = require('../config/roleMapping');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const recordActivity = require('../utils/recordActivity');
const logger = require('../utils/logger');

const RESET_TOKEN_TTL_MINUTES = 15;
const VERIFICATION_TOKEN_TTL_MINUTES = 15;

// Roles the public /auth/register endpoint may create directly. Anything
// else (including any attempt to self-register as super_admin) silently
// falls back to student, same as this endpoint's original behavior for an
// unrecognized role.
const SELF_REGISTERABLE_ROLES = [ROLES.STUDENT, ROLES.INSTITUTION_ADMIN, ROLES.HR];

function sanitizeUser(user) {
  if (!user) return null;
  const {
    password_hash,
    reset_password_token_hash,
    email_verification_token_hash,
    ...safe
  } = user;
  return safe;
}

// Attaches the institution's name so the frontend can infer engineering vs.
// arts-and-science (see src/lib/departmentCatalog.ts) without a separate
// round trip — `institution_id` alone isn't enough for that client-side check.
async function withCollegeName(user) {
  if (!user || !user.institution_id) return user;
  const institution = await institutionRepository.findById(user.institution_id);
  return institution ? { ...user, college_name: institution.name } : user;
}

function issueTokens(user) {
  // `tv` (token_version) is checked on every refresh — see refresh() below.
  // Bumping it on password reset invalidates every refresh token issued
  // before that point, without needing a server-side revocation store.
  const payload = { sub: user.id, role: user.role, institutionId: user.institution_id, tv: user.token_version || 0 };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

// Public self-service registration. Originally student-only; extended per
// the Phase 3h migration plan because the live frontend actively registers
// college_admin/institution_admin and hr accounts through this same
// endpoint (CollegeAdminLogin.tsx, HrLogin.tsx, LearnerLogin.tsx's recruiter
// path) — python-service's version already supported this, so leaving it
// student-only here would have silently broken those three real signup
// flows once the frontend cuts over. Non-student roles land as `pending`
// and get no tokens (must wait on admin approval), matching python exactly;
// student stays immediately usable.
async function register({ email, password, name, fullName, phone, institutionId, role, companyName, company_name: companyNameSnake }) {
  const existing = await userRepository.findByEmail(email);
  if (existing) throw ApiError.conflict('An account with this email already exists');

  const resolvedFullName = fullName || name;
  const resolvedCompanyName = companyName || companyNameSnake;
  const requestedRole = mapPythonRole(role);
  const finalRole = SELF_REGISTERABLE_ROLES.includes(requestedRole) ? requestedRole : ROLES.STUDENT;
  const status = finalRole === ROLES.STUDENT ? 'approved' : 'pending';

  const passwordHash = await hashPassword(password);
  const rawVerificationToken = generateRawToken();
  const user = await userRepository.create({
    email,
    password_hash: passwordHash,
    full_name: resolvedFullName,
    phone,
    role: finalRole,
    institution_id: institutionId || null,
    status,
    // No dedicated column for this — it's only ever used by an admin
    // reviewing a pending HR signup, not read anywhere else, so it isn't
    // worth a schema field of its own.
    preferences: resolvedCompanyName ? { company_name: resolvedCompanyName } : undefined,
    email_verification_token_hash: hashToken(rawVerificationToken),
    email_verification_expires: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MINUTES * 60 * 1000),
  });

  // A `users` row alone doesn't make a student usable — every institution-scoped
  // feature (tests, placements, dashboard stats) reads through a `students` row
  // keyed by user_id (see studentRepository.findByUserId). Without this, a
  // self-registered student silently 404s everywhere until they happen to hit
  // the separate self-service /students/profile endpoint, which nothing in the
  // frontend currently prompts them to do. Create it here, atomically with the
  // account, the same way the admin-provisioned batch-import path already does.
  if (finalRole === ROLES.STUDENT) {
    await studentRepository.create({
      user_id: user.id,
      institution_id: institutionId || null,
      profile_completed: false,
    });
  }

  await recordActivity({ userId: user.id, action: 'register', entityType: 'user', entityId: user.id });

  // Best-effort: registration must succeed regardless of whether the
  // verification email actually sends (e.g. Brevo not configured locally).
  const verifyUrl = `${env.frontendUrl}/verify-email?token=${rawVerificationToken}`;
  const { subject, html, text } = verificationTemplate({
    fullName: resolvedFullName,
    verifyUrl,
    expiresInMinutes: VERIFICATION_TOKEN_TTL_MINUTES,
  });
  await sendEmail({ to: email, subject, html, text });

  if (status === 'pending') {
    return { user: sanitizeUser(user), pending: true };
  }
  return { user: sanitizeUser(user), ...issueTokens(user) };
}

async function login({ email, password }) {
  const user = await userRepository.findByEmail(email);
  if (!user || !user.is_active) throw ApiError.unauthorized('Invalid email or password');

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) throw ApiError.unauthorized('Invalid email or password');

  // Bulk-onboarded students with a generated temp password (see
  // utils/studentOnboarding.js) can't get a real session until they set their
  // own password — credentials did authenticate, so this is a "next step
  // required" outcome, not an auth failure.
  if (user.must_change_password) {
    return { mustChangePassword: true, user: sanitizeUser(user) };
  }

  await userRepository.updateById(user.id, { last_login_at: new Date() });
  await recordActivity({ userId: user.id, action: 'login', entityType: 'user', entityId: user.id });
  return { user: await withCollegeName(sanitizeUser(user)), ...issueTokens(user) };
}

// Completes onboarding for an account created with a generated temp password.
// Rejects if the account isn't actually in a must-change state, so this can
// never become a general "log in with old password to set a new one" backdoor
// for accounts that already finished onboarding — that's what resetPassword/
// forgotPassword are for.
async function changeInitialPassword({ email, currentPassword, newPassword }) {
  const user = await userRepository.findByEmail(email);
  if (!user || !user.is_active) throw ApiError.unauthorized('Invalid email or password');
  if (!user.must_change_password) {
    throw ApiError.badRequest('This account does not require a password change');
  }

  const valid = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) throw ApiError.unauthorized('Invalid email or password');

  const passwordHash = await hashPassword(newPassword);
  const updated = await userRepository.updateById(user.id, {
    password_hash: passwordHash,
    must_change_password: false,
    // Same reasoning as resetPassword(): invalidates any refresh token that
    // might already exist for this account.
    token_version: (user.token_version || 0) + 1,
    last_login_at: new Date(),
  });
  await recordActivity({ userId: user.id, action: 'change_initial_password', entityType: 'user', entityId: user.id });

  return { user: await withCollegeName(sanitizeUser(updated)), ...issueTokens(updated) };
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
        // Google already verified this address.
        is_email_verified: true,
      });
      // Same reasoning as register() above — a brand-new student account
      // needs a `students` row to be usable anywhere, and Google sign-up
      // never lands in the batch-import path that would otherwise create one.
      await studentRepository.create({ user_id: user.id, institution_id: null, profile_completed: false });
    }
  }

  if (!user.is_active) throw ApiError.unauthorized('This account has been deactivated');

  await userRepository.updateById(user.id, { last_login_at: new Date() });
  await recordActivity({ userId: user.id, action: 'google_login', entityType: 'user', entityId: user.id });
  return { user: await withCollegeName(sanitizeUser(user)), ...issueTokens(user) };
}

async function refresh(refreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const user = await userRepository.findById(payload.sub);
  if (!user || !user.is_active) throw ApiError.unauthorized('Account no longer active');

  // A password reset bumps token_version — any refresh token issued before
  // that point (payload.tv holds the version at issuance time) is rejected,
  // even though it's still a validly-signed, unexpired JWT.
  if ((payload.tv || 0) !== (user.token_version || 0)) {
    throw ApiError.unauthorized('Session no longer valid, please log in again');
  }

  return issueTokens(user);
}

async function me(userId) {
  const user = await userRepository.findById(userId);
  if (!user) throw ApiError.notFound('User not found');
  return withCollegeName(sanitizeUser(user));
}

// Never reveals whether `email` belongs to a real account — the controller
// returns the same generic success message either way. Enumeration would let
// an attacker build a list of valid accounts to target with credential
// stuffing or phishing, so silence is the only safe response shape here.
async function forgotPassword(email) {
  const user = await userRepository.findByEmail(email);
  if (!user) {
    logger.info('Password reset requested for unknown email (no-op)', { email });
    return;
  }

  const rawToken = generateRawToken();
  await userRepository.updateById(user.id, {
    reset_password_token_hash: hashToken(rawToken),
    reset_password_expires: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
  });
  logger.info('Password reset requested', { userId: user.id });

  const resetUrl = `${env.frontendUrl}/reset-password?token=${rawToken}`;
  const { subject, html, text } = passwordResetTemplate({
    fullName: user.full_name,
    resetUrl,
    expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
  });
  await sendEmail({ to: user.email, subject, html, text });
}

async function resetPassword(rawToken, newPassword) {
  const tokenHash = hashToken(rawToken);
  const user = await userRepository.findByResetTokenHash(tokenHash);

  // Same "invalid or expired" message for both cases — distinguishing them
  // would tell an attacker which guessed tokens are merely stale vs. entirely
  // wrong, narrowing the search space.
  if (!user || !user.reset_password_expires || new Date(user.reset_password_expires) < new Date()) {
    throw ApiError.badRequest('This reset link is invalid or has expired');
  }

  const passwordHash = await hashPassword(newPassword);
  await userRepository.updateById(user.id, {
    password_hash: passwordHash,
    reset_password_token_hash: null,
    reset_password_expires: null,
    // Invalidates every refresh token (every other logged-in session) issued
    // before this reset — see issueTokens()/refresh() above.
    token_version: (user.token_version || 0) + 1,
  });
  logger.info('Password reset completed', { userId: user.id });
}

// Authenticated password change (as opposed to the token-based reset flow
// above). Requires proving knowledge of the current password rather than a
// mailed token. Bumps token_version like resetPassword/changeInitialPassword
// — any refresh token issued before this point (e.g. a stolen or forgotten
// logged-in session elsewhere) stops working, which is the point of changing
// a password. Returns a freshly issued pair for the caller's own session so
// this endpoint doesn't strand the very session that just changed it.
async function changePassword(userId, currentPassword, newPassword) {
  const user = await userRepository.findById(userId);
  if (!user || !user.is_active) throw ApiError.unauthorized('Account no longer active');

  const valid = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) throw ApiError.badRequest('Current password is incorrect');

  const samePassword = await verifyPassword(newPassword, user.password_hash);
  if (samePassword) throw ApiError.badRequest('New password must be different from the current password');

  const passwordHash = await hashPassword(newPassword);
  const updated = await userRepository.updateById(user.id, {
    password_hash: passwordHash,
    token_version: (user.token_version || 0) + 1,
  });
  await recordActivity({ userId: user.id, action: 'change_password', entityType: 'user', entityId: user.id });
  logger.info('Password changed', { userId: user.id });

  return { user: sanitizeUser(updated), ...issueTokens(updated) };
}

async function verifyEmail(rawToken) {
  const tokenHash = hashToken(rawToken);
  const user = await userRepository.findByVerificationTokenHash(tokenHash);

  if (!user || !user.email_verification_expires || new Date(user.email_verification_expires) < new Date()) {
    throw ApiError.badRequest('This verification link is invalid or has expired');
  }

  await userRepository.updateById(user.id, {
    is_email_verified: true,
    email_verification_token_hash: null,
    email_verification_expires: null,
  });
  logger.info('Email verification completed', { userId: user.id });
}

module.exports = {
  register,
  login,
  googleLogin,
  refresh,
  me,
  forgotPassword,
  resetPassword,
  changeInitialPassword,
  changePassword,
  verifyEmail,
  sanitizeUser,
};
