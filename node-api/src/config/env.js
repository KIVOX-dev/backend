// Loads and validates process environment for the Node/Express API.
// Uses .env.node (not .env / .env.example, which belong to the existing Python service).
require('dotenv').config({ path: '.env.node' });

const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'MONGODB_URI', 'TURNSTILE_SECRET_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.PORT, 10) || 5000,
  apiPrefix: process.env.API_PREFIX || '/api/v1',

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  mongo: {
    uri: process.env.MONGODB_URI,
    dbName: process.env.MONGODB_DB_NAME || 'upscaler_ai_node',
    poolMax: parseInt(process.env.MONGO_POOL_MAX, 10) || 20,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },

  // Lets a student connect their GitHub account from the Integrations tab.
  // Optional, same philosophy as aiService/brevo below — githubAuth.service.js
  // degrades to a 503 on /auth/github/connect rather than blocking boot when unset.
  github: {
    clientId: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    // Must exactly match the "Authorization callback URL" registered on the
    // GitHub OAuth App — GitHub rejects the exchange otherwise.
    callbackUrl: process.env.GITHUB_CALLBACK_URL || '',
    // A single personal access token for the TalentSnaps GitHub account
    // itself — NOT per-student. Contribution calendars are public data on
    // GitHub's GraphQL API; any authenticated token can read any public
    // user's, so this one token (no special scopes needed) is enough to back
    // every connected student's "My Activity" heatmap. Deliberately separate
    // from clientId/clientSecret above, which are the OAuth App's connect
    // flow — this one only ever makes read-only GraphQL queries.
    appToken: process.env.GITHUB_APP_TOKEN || '',
  },

  // Profile photos, cover banners, and onboarding photo/signature uploads
  // (middlewares/upload.js, utils/gcsClient.js). Cloud Run's own filesystem
  // is wiped on every restart/redeploy/scale event, so anything meant to
  // persist has to land in real cloud storage. The bucket must NOT grant
  // allUsers read access: objects are private and only ever reached through
  // short-lived V4 signed URLs (utils/privateMedia.js). Optional: avatar/
  // cover uploads 503 and onboarding uploads fall back to local disk (dev/
  // tests only) until this is set, same philosophy as aiService/brevo above.
  gcs: {
    bucketName: process.env.GCS_BUCKET_NAME || '',
    // Lifetime of every signed URL handed out for a profile photo, cover, or
    // signature. Clamped to 60s..7 days (7 days is V4 signing's own maximum).
    mediaUrlTtlSeconds: Math.min(
      Math.max(parseInt(process.env.MEDIA_URL_TTL_SECONDS, 10) || 900, 60),
      7 * 24 * 60 * 60
    ),
    // Placement-proof offer letters (utils/placementProofStorage.js), stored
    // per institution under placement-proof/<institution_id>/. Defaults to
    // the profile-photo bucket above. A separate bucket is still recommended
    // (offer letters carry salary/employer details, and a separate bucket
    // keeps their IAM and retention independent). Unset both = local disk
    // (dev/tests only — not durable on Cloud Run).
    documentsBucketName: process.env.GCS_DOCUMENTS_BUCKET_NAME || process.env.GCS_BUCKET_NAME || '',
  },

  // Lets a student connect their LinkedIn identity — "Sign In with LinkedIn
  // using OpenID Connect" only, not the old, now-restricted r_liteprofile/
  // r_emailaddress scopes. Only verified name/email/photo are available at
  // this scope tier; work history/skills require LinkedIn's separately
  // gated Marketing Developer Platform partnership, which this app doesn't have.
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID || '',
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
    callbackUrl: process.env.LINKEDIN_CALLBACK_URL || '',
  },

  // Lets a student connect their Stack Overflow identity via Stack
  // Exchange's real OAuth 2.0 (stackapps.com/apps/oauth/register). `key` is
  // a separate "app key" Stack Exchange issues alongside client id/secret —
  // required on every API call alongside the access token, not a substitute
  // for client_secret.
  stackexchange: {
    clientId: process.env.STACKEXCHANGE_CLIENT_ID || '',
    clientSecret: process.env.STACKEXCHANGE_CLIENT_SECRET || '',
    key: process.env.STACKEXCHANGE_KEY || '',
    callbackUrl: process.env.STACKEXCHANGE_CALLBACK_URL || '',
  },

  // Powers "YouTube to Course" (Tools > YouTube to Course) — fetches video/
  // playlist metadata via YouTube Data API v3. Optional, same philosophy as
  // github/linkedin/stackexchange above — course.service.js degrades to a
  // 503 on /courses/import until this is set.
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY || '',
  },

  // The FastAPI AI microservice (interview generation, resume AI features).
  // Not required at startup — utils/aiServiceClient.js degrades gracefully
  // (local fallback) when unset or unreachable, same philosophy as groq above.
  aiService: {
    url: process.env.AI_SERVICE_URL || 'http://localhost:8001',
    sharedSecret: process.env.AI_SERVICE_SHARED_SECRET || '',
    timeoutMs: parseInt(process.env.AI_SERVICE_TIMEOUT_MS, 10) || 15000,
  },

  // Optional, same reasoning as groq above — see email.service.js#isEmailConfigured.
  brevo: {
    apiKey: process.env.BREVO_API_KEY || '',
    senderEmail: process.env.BREVO_SENDER_EMAIL || '',
    senderName: process.env.BREVO_SENDER_NAME || '',
  },

  // Used to build reset-password/verify-email links sent by email.
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  // Cloudflare Turnstile — gates /auth/register and /auth/forgot-password
  // against bot abuse (see middlewares/verifyTurnstile.js). The secret is
  // required at boot, same as the JWT secrets, since an unset value would
  // otherwise silently disable a security control rather than fail loudly.
  turnstile: {
    secretKey: process.env.TURNSTILE_SECRET_KEY,
    // Optional: comma-separated allow-list of hostnames the widget is
    // expected to be served from (siteverify's `hostname` response field).
    // Left empty, hostname isn't checked — set this in production once the
    // frontend's deployed domain is known.
    allowedHostnames: (process.env.TURNSTILE_HOSTNAMES || '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 300,
  },
};
