// Deterministic, order-independent-on-keys (but order-preserving-on-arrays)
// serialization of a MongoDB document, used to compute a stable checksum per
// document for Phase 5 verification. Handles the BSON types this app
// actually uses (Date, string _id, nested objects/arrays, null, numbers,
// booleans) plus ObjectId/Binary defensively in case either ever appears.
const crypto = require('crypto');

function canonicalValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return { __type: 'Date', v: value.toISOString() };
  // BSON ObjectId / Binary both expose toHexString(); duck-type rather than
  // require('mongodb') here so this module has zero driver dependency.
  if (typeof value.toHexString === 'function') return { __type: 'ObjectId', v: value.toHexString() };
  if (Buffer.isBuffer(value)) return { __type: 'Binary', v: value.toString('base64') };
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalValue(value[key]);
    }
    return out;
  }
  return value; // string, number, boolean
}

function hashDocument(doc) {
  const canonical = canonicalValue(doc);
  const json = JSON.stringify(canonical);
  return crypto.createHash('sha256').update(json).digest('hex');
}

module.exports = { hashDocument, canonicalValue };
