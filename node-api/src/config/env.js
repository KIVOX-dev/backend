// Loads and validates process environment for the Node/Express API.
// Uses .env.node (not .env / .env.example, which belong to the existing Python service).
require('dotenv').config({ path: '.env.node' });

const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'MONGODB_URI'];
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

  // Optional: routes that call Groq must check isGroqConfigured() (see
  // src/utils/groqClient.js) and degrade gracefully rather than crash — not
  // required at startup because not every deployment needs AI features.
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
  },

  // Optional, same reasoning as groq above — see email.service.js#isEmailConfigured.
  brevo: {
    apiKey: process.env.BREVO_API_KEY || '',
    senderEmail: process.env.BREVO_SENDER_EMAIL || '',
    senderName: process.env.BREVO_SENDER_NAME || '',
  },

  // Used to build reset-password/verify-email links sent by email.
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 300,
  },
};
