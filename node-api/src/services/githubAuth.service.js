const studentRepository = require('../repositories/student.repository');
const { signState, verifyState } = require('../utils/githubOAuthState');
const { exchangeCodeForToken, fetchGitHubUser, GitHubOAuthError } = require('../utils/githubClient');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const recordActivity = require('../utils/recordActivity');
const logger = require('../utils/logger');

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

class GithubAuthService {
  isConfigured() {
    return Boolean(env.github.clientId && env.github.clientSecret && env.github.callbackUrl);
  }

  getAuthorizeUrl(actor) {
    if (!this.isConfigured()) throw ApiError.serviceUnavailable('GitHub integration is not configured');

    const state = signState(actor.id);
    const params = new URLSearchParams({
      client_id: env.github.clientId,
      redirect_uri: env.github.callbackUrl,
      scope: 'read:user',
      state,
      allow_signup: 'false',
    });
    return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
  }

  // Always resolves to a frontend URL, never throws — this runs at the tail
  // of a browser redirect chain with no JSON caller left to catch an error,
  // so every failure mode has to end in "send the browser somewhere sensible"
  // instead. `reason` is only ever one of the fixed strings below (never
  // GitHub/user-supplied text), so it's safe to place directly in the query
  // string with no further encoding.
  async handleCallback({ code, state, error }) {
    // The frontend has no standalone /settings route — Settings is a
    // client-side screen inside /learner (see uiStore.ts's activeScreen),
    // not its own URL. `screen=settings` tells that page which screen to
    // switch to on load; SettingsPanel.tsx itself reads `tab`/`github`/`reason`.
    const target = `${env.frontendUrl}/learner?screen=settings&tab=integrations`;
    if (error) return `${target}&github=error&reason=denied`;
    if (!code || !state) return `${target}&github=error&reason=invalid_request`;

    let userId;
    try {
      userId = verifyState(state).sub;
    } catch {
      return `${target}&github=error&reason=expired`;
    }

    try {
      const accessToken = await exchangeCodeForToken({
        code,
        clientId: env.github.clientId,
        clientSecret: env.github.clientSecret,
        redirectUri: env.github.callbackUrl,
      });
      const profile = await fetchGitHubUser(accessToken);

      const existingOwner = await studentRepository.findOne({ github_id: profile.id });
      if (existingOwner && existingOwner.user_id !== userId) {
        return `${target}&github=error&reason=already_linked`;
      }

      const student = await studentRepository.findByUserId(userId);
      if (!student) return `${target}&github=error&reason=no_profile`;

      await studentRepository.updateById(student.id, {
        github_id: profile.id,
        github_username: profile.username,
        github_avatar_url: profile.avatarUrl,
        github_connected_at: new Date(),
      });
      await recordActivity({ userId, action: 'github_connect', entityType: 'student', entityId: student.id });

      return `${target}&github=connected`;
    } catch (err) {
      logger.error('GitHub connect failed', { error: err.message });
      return `${target}&github=error&reason=${err instanceof GitHubOAuthError ? 'github_error' : 'server_error'}`;
    }
  }

  async disconnect(actor) {
    const student = await studentRepository.findByUserId(actor.id);
    if (!student) throw ApiError.notFound('Profile not found');

    await recordActivity({ userId: actor.id, action: 'github_disconnect', entityType: 'student', entityId: student.id });
    return studentRepository.updateById(student.id, {
      github_id: null,
      github_username: null,
      github_avatar_url: null,
      github_connected_at: null,
    });
  }
}

module.exports = new GithubAuthService();
