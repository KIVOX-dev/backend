const studentRepository = require('../repositories/student.repository');
const { signState, verifyState } = require('../utils/oauthState');
const { exchangeCodeForToken, fetchLinkedInUser, LinkedInOAuthError } = require('../utils/linkedinClient');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const recordActivity = require('../utils/recordActivity');
const logger = require('../utils/logger');

const LINKEDIN_AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';

class LinkedinAuthService {
  isConfigured() {
    return Boolean(env.linkedin.clientId && env.linkedin.clientSecret && env.linkedin.callbackUrl);
  }

  getAuthorizeUrl(actor) {
    if (!this.isConfigured()) throw ApiError.serviceUnavailable('LinkedIn integration is not configured');

    const state = signState(actor.id, 'linkedin');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.linkedin.clientId,
      redirect_uri: env.linkedin.callbackUrl,
      // openid+profile+email is the only scope tier "Sign In with LinkedIn
      // using OpenID Connect" grants — see linkedinClient.js#fetchLinkedInUser.
      scope: 'openid profile email',
      state,
    });
    return `${LINKEDIN_AUTHORIZE_URL}?${params.toString()}`;
  }

  async handleCallback({ code, state, error }) {
    const target = `${env.frontendUrl}/learner?screen=settings&tab=integrations`;
    if (error) return `${target}&linkedin=error&reason=denied`;
    if (!code || !state) return `${target}&linkedin=error&reason=invalid_request`;

    let userId;
    try {
      userId = verifyState(state, 'linkedin').sub;
    } catch {
      return `${target}&linkedin=error&reason=expired`;
    }

    try {
      const accessToken = await exchangeCodeForToken({
        code,
        clientId: env.linkedin.clientId,
        clientSecret: env.linkedin.clientSecret,
        redirectUri: env.linkedin.callbackUrl,
      });
      const profile = await fetchLinkedInUser(accessToken);

      const existingOwner = await studentRepository.findOne({ linkedin_id: profile.id });
      if (existingOwner && existingOwner.user_id !== userId) {
        return `${target}&linkedin=error&reason=already_linked`;
      }

      const student = await studentRepository.findByUserId(userId);
      if (!student) return `${target}&linkedin=error&reason=no_profile`;

      await studentRepository.updateById(student.id, {
        linkedin_id: profile.id,
        linkedin_name: profile.name,
        linkedin_email: profile.email,
        linkedin_avatar_url: profile.avatarUrl,
        linkedin_connected_at: new Date(),
      });
      await recordActivity({ userId, action: 'linkedin_connect', entityType: 'student', entityId: student.id });

      return `${target}&linkedin=connected`;
    } catch (err) {
      logger.error('LinkedIn connect failed', { error: err.message });
      return `${target}&linkedin=error&reason=${err instanceof LinkedInOAuthError ? 'linkedin_error' : 'server_error'}`;
    }
  }

  async disconnect(actor) {
    const student = await studentRepository.findByUserId(actor.id);
    if (!student) throw ApiError.notFound('Profile not found');

    await recordActivity({ userId: actor.id, action: 'linkedin_disconnect', entityType: 'student', entityId: student.id });
    return studentRepository.updateById(student.id, {
      linkedin_id: null,
      linkedin_name: null,
      linkedin_email: null,
      linkedin_avatar_url: null,
      linkedin_connected_at: null,
    });
  }
}

module.exports = new LinkedinAuthService();
