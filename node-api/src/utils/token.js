const crypto = require('crypto');

// Two representations of the same value, deliberately: the RAW token is what
// goes into the emailed link — it's the only copy that ever leaves the
// server, so it must be unguessable (32 random bytes). The HASH is what gets
// stored in MongoDB. Storing the hash instead of the raw token means a
// database read (a backup leak, a careless log line, an injection bug) can't
// be turned back into a working reset/verification link — exactly the same
// reason passwords are hashed rather than stored in plain text.
function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

module.exports = { generateRawToken, hashToken };
