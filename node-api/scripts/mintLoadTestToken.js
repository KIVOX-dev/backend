// Mints a long-lived access token for load testing, signed with the current
// .env.node JWT_SECRET — bypasses login (and its authLimiter budget) so a
// benchmark can hit protected routes without spending requests on auth.
// Never use the output against a production JWT_SECRET or commit it anywhere.
//
// Usage:
//   node scripts/mintLoadTestToken.js [userId] [role] [institutionId]
//   node scripts/mintLoadTestToken.js --ttl 4h
require('dotenv').config({ path: '.env.node' });
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');

const args = process.argv.slice(2).filter((a) => a !== '--ttl');
const ttlIndex = process.argv.indexOf('--ttl');
const ttl = ttlIndex !== -1 ? process.argv[ttlIndex + 1] : '2h';

const [userId = '000000000000000000000000', role = 'student', institutionId = '000000000000000000000000'] = args;

const payload = { sub: userId, role, institutionId, tv: 0 };
const token = jwt.sign(payload, env.jwt.secret, { expiresIn: ttl });

console.log(token);
console.error(`\nMinted for sub=${userId} role=${role} institutionId=${institutionId}, expires in ${ttl}.`);
console.error('Use a real ObjectId for userId/institutionId if the endpoint under test does a DB lookup.');
