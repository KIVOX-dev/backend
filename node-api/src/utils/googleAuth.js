const { OAuth2Client } = require('google-auth-library');
const env = require('../config/env');
const ApiError = require('./ApiError');

const client = new OAuth2Client(env.google.clientId);

// Verifies a Google ID token sent by the frontend (Google Identity Services credential),
// never trusting client-supplied profile fields directly.
async function verifyGoogleIdToken(idToken) {
  if (!idToken) {
    throw ApiError.badRequest('Google idToken is required');
  }
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.google.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload.email_verified) {
      throw ApiError.unauthorized('Google email is not verified');
    }
    return {
      googleId: payload.sub,
      email: payload.email,
      fullName: payload.name || payload.email,
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.unauthorized('Invalid Google ID token');
  }
}

module.exports = { verifyGoogleIdToken };
