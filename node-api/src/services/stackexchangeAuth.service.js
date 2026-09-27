const studentRepository = require('../repositories/student.repository');
const { signState, verifyState } = require('../utils/oauthState');
const { exchangeCodeForToken, fetchStackExchangeUser, StackExchangeOAuthError } = require('../utils/stackexchangeClient');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const recordActivity = require('../utils/recordActivity');
const logger = require('../utils/logger');

// Stack Exchange's auth dialog lives on a specific site's domain even though
// the resulting access token works network-wide via api.stackexchange.com —
// stackoverflow.com is the site this app cares about.
const STACKEXCHANGE_AUTHORIZE_URL = 'https://stackoverflow.com/oauth/dialog';

class StackexchangeAuthService {
  isConfigured() {
    return Boolean(
      env.stackexchange.clientId && env.stackexchange.clientSecret && env.stackexchange.key && env.stackexchange.callbackUrl
    );
  }

  getAuthorizeUrl(actor) {
    if (!this.isConfigured()) throw ApiError.serviceUnavailable('Stack Overflow integration is not configured');

    const state = signState(actor.id, 'stackexchange');
    const params = new URLSearchParams({
      client_id: env.stackexchange.clientId,
      redirect_uri: env.stackexchange.callbackUrl,
      state,
    });
    return `${STACKEXCHANGE_AUTHORIZE_URL}?${params.toString()}`;
  }

  async handleCallback({ code, state, error }) {
    // Integrations lives on the Profile screen, not Settings — see
    // githubAuth.service.js's comment on this same redirect shape.
    const target = `${env.frontendUrl}/learner?screen=profile-info&tab=integrations`;
    if (error) return `${target}&stackoverflow=error&reason=denied`;
    if (!code || !state) return `${target}&stackoverflow=error&reason=invalid_request`;

    try {
      verifyState(state, 'stackexchange');
    } catch {
      return `${target}&stackoverflow=error&reason=expired`;
    }

    // Not linked here: this request carries no session, so nothing ties it
    // to the browser that started the connect, and an attacker could send
    // someone an authorize link carrying the attacker's own state to attach
    // that person's account to the attacker's profile. The app posts
    // code+state to /confirm with its own Bearer token instead.
    return `${target}&${new URLSearchParams({ stackoverflow: 'confirm', code, state })}`;
  }

  // Finishes a connect for the signed-in student, only if the state was
  // minted for that same student (see handleCallback). Returns 'connected' or
  // one of the fixed error reasons the frontend already has messages for.
  async confirm(actor, { code, state }) {
    let userId;
    try {
      userId = verifyState(state, 'stackexchange').sub;
    } catch {
      return 'expired';
    }
    if (String(userId) !== String(actor.id)) return 'wrong_account';

    try {
      const accessToken = await exchangeCodeForToken({
        code,
        clientId: env.stackexchange.clientId,
        clientSecret: env.stackexchange.clientSecret,
        redirectUri: env.stackexchange.callbackUrl,
      });
      const profile = await fetchStackExchangeUser(accessToken, env.stackexchange.key);

      const existingOwner = await studentRepository.findOne({ stackoverflow_id: profile.id });
      if (existingOwner && existingOwner.user_id !== userId) {
        return 'already_linked';
      }

      const student = await studentRepository.findByUserId(userId);
      if (!student) return 'no_profile';

      await studentRepository.updateById(student.id, {
        stackoverflow_id: profile.id,
        stackoverflow_display_name: profile.displayName,
        stackoverflow_reputation: profile.reputation,
        stackoverflow_avatar_url: profile.avatarUrl,
        stackoverflow_profile_url: profile.profileUrl,
        stackoverflow_connected_at: new Date(),
      });
      await recordActivity({ userId, action: 'stackoverflow_connect', entityType: 'student', entityId: student.id });

      return 'connected';
    } catch (err) {
      logger.error('Stack Overflow connect failed', { error: err.message });
      return err instanceof StackExchangeOAuthError ? 'stackexchange_error' : 'server_error';
    }
  }

  async disconnect(actor) {
    const student = await studentRepository.findByUserId(actor.id);
    if (!student) throw ApiError.notFound('Profile not found');

    await recordActivity({ userId: actor.id, action: 'stackoverflow_disconnect', entityType: 'student', entityId: student.id });
    return studentRepository.updateById(student.id, {
      stackoverflow_id: null,
      stackoverflow_display_name: null,
      stackoverflow_reputation: null,
      stackoverflow_avatar_url: null,
      stackoverflow_profile_url: null,
      stackoverflow_connected_at: null,
    });
  }
}

module.exports = new StackexchangeAuthService();
