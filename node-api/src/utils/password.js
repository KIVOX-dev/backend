const crypto = require('crypto');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — visually ambiguous with 1/0
const LOWER = 'abcdefghijkmnpqrstuvwxyz'; // no l/o
const DIGITS = '23456789'; // no 0/1
const SYMBOLS = '!@#$%^&*-_+=';
const ALL_CHARS = UPPER + LOWER + DIGITS + SYMBOLS;

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

async function verifyPassword(plainPassword, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compare(plainPassword, passwordHash);
}

function randomChar(pool) {
  return pool[crypto.randomInt(pool.length)];
}

// Cryptographically random temp password (crypto.randomInt, not Math.random)
// guaranteed to contain at least one upper/lower/digit/symbol, for one-off
// bulk student onboarding — see utils/studentOnboarding.js.
function generateSecurePassword(length = 16) {
  const required = [randomChar(UPPER), randomChar(LOWER), randomChar(DIGITS), randomChar(SYMBOLS)];
  const rest = Array.from({ length: length - required.length }, () => randomChar(ALL_CHARS));
  const chars = [...required, ...rest];

  // Fisher-Yates shuffle using crypto.randomInt so the required chars aren't
  // always in the same leading positions.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

module.exports = { hashPassword, verifyPassword, generateSecurePassword };
