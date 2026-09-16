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
    const target = `${env.frontendUrl}/learner?screen=settings&tab=integrations`;
    if (error) return `${target}&stackoverflow=error&reason=denied`;
    if (!code || !state) return `${target}&stackoverflow=error&reason=invalid_request`;

    let userId;
    try {
      userId = verifyState(state, 'stackexchange').sub;
    } catch {
      return `${target}&stackoverflow=error&reason=expired`;
    }

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
        return `${target}&stackoverflow=error&reason=already_linked`;
      }

      const student = await studentRepository.findByUserId(userId);
      if (!student) return `${target}&stackoverflow=error&reason=no_profile`;

      await studentRepository.updateById(student.id, {
        stackoverflow_id: profile.id,
        stackoverflow_display_name: profile.displayName,
        stackoverflow_reputation: profile.reputation,
        stackoverflow_avatar_url: profile.avatarUrl,
        stackoverflow_profile_url: profile.profileUrl,
        stackoverflow_connected_at: new Date(),
      });
      await recordActivity({ userId, action: 'stackoverflow_connect', entityType: 'student', entityId: student.id });

      return `${target}&stackoverflow=connected`;
    } catch (err) {
      logger.error('Stack Overflow connect failed', { error: err.message });
      return `${target}&stackoverflow=error&reason=${err instanceof StackExchangeOAuthError ? 'stackexchange_error' : 'server_error'}`;
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
