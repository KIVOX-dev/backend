module.exports = {
  tableName: 'users',
  columns: [
    'email', 'password_hash', 'google_id', 'full_name', 'phone',
    'role', 'institution_id', 'is_active', 'last_login_at',
    // Ported from python-service's users.py:
    'status', 'is_email_verified', 'avatar_url', 'preferences', 'department',
    // Email verification + password reset (see authService.js). Only the
    // hashed token is ever stored — see utils/token.js for why.
    'email_verification_token_hash', 'email_verification_expires',
    'reset_password_token_hash', 'reset_password_expires',
    // Bumped on password reset; embedded in every issued JWT (`tv` claim) and
    // checked on refresh, so a password reset invalidates every refresh token
    // issued before it — see authService.js#refresh.
    'token_version',
  ],
  // status: pending|approved|rejected — mirrors python-service. Admin-provisioned
  // users are approved immediately (self-registration's default is Phase 4 scope,
  // where the rest of the auth system gets rebuilt).
  defaults: { is_active: true, status: 'approved', is_email_verified: false, token_version: 0 },
};
