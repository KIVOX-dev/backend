const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

// Adds duplicate, differently-named copies of the same fields the live
// frontend's existing login/register/refresh call sites read (e.g.
// `access_token` alongside `accessToken`, `user.name` alongside
// `user.full_name`) — see the Phase 3h migration plan's "auth response
// compat" note. Auth is the highest-traffic surface (8 call sites across
// every login component); duplicating a few fields here is far lower risk
// than editing all of them, and mirrors a pattern python-service's own auth
// responses already used deliberately for the same reason.
function withLegacyAuthFields(result) {
  const out = { ...result };
  if (result.accessToken) {
    out.access_token = result.accessToken;
    out.token = result.accessToken;
  }
  if (result.refreshToken) out.refresh_token = result.refreshToken;
  if (result.user) {
    out.user = {
      ...result.user,
      name: result.user.full_name,
      college_id: result.user.institution_id,
      collegeId: result.user.institution_id,
    };
  }
  return out;
}

const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  ApiResponse.created(res, withLegacyAuthFields(result), 'Registration successful');
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  if (result.mustChangePassword) {
    ApiResponse.ok(res, { mustChangePassword: true, user: result.user }, 'You must set a new password before continuing');
    return;
  }
  ApiResponse.ok(res, withLegacyAuthFields(result), 'Login successful');
});

const changeInitialPassword = asyncHandler(async (req, res) => {
  const result = await authService.changeInitialPassword(req.body);
  ApiResponse.ok(res, withLegacyAuthFields(result), 'Password set successfully');
});

const googleLogin = asyncHandler(async (req, res) => {
  const result = await authService.googleLogin(req.body.idToken);
  ApiResponse.ok(res, withLegacyAuthFields(result), 'Login successful');
});

const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body.refreshToken);
  ApiResponse.ok(res, withLegacyAuthFields(result), 'Token refreshed');
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.me(req.user.id);
  ApiResponse.ok(res, user);
});

// Always the same generic message, whether or not the email belongs to a
// real account — see authService.js#forgotPassword for why.
const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body.email);
  ApiResponse.ok(res, null, 'If an account exists for that email, a password reset link has been sent.');
});

const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body.token, req.body.newPassword);
  ApiResponse.ok(res, null, 'Password has been reset. Please log in with your new password.');
});

const verifyEmail = asyncHandler(async (req, res) => {
  await authService.verifyEmail(req.query.token);
  ApiResponse.ok(res, null, 'Email verified successfully.');
});

module.exports = { register, login, googleLogin, refresh, me, forgotPassword, resetPassword, changeInitialPassword, verifyEmail };
