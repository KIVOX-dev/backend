const env = require('../config/env');
const logger = require('./logger');
const signedUrl = require('./signedUrl');
const { signReadUrl } = require('./gcsClient');

// Profile photos, cover banners, and onboarding photo/signature uploads are
// private objects. What gets stored in MongoDB is a *reference*, never a
// working URL:
//   gs://<GCS_BUCKET_NAME>/<prefix>/<uuid>.<ext>   (current, GCS)
//   /uploads/profile/<uuid>.<ext>                   (local disk: dev/tests, and legacy onboarding rows)
//   https://storage.googleapis.com/<GCS_BUCKET_NAME>/<prefix>/<uuid>.<ext>
//                                                   (legacy: written back when the bucket was public-read)
// middlewares/signPrivateMedia.js swaps each reference for a short-lived
// signed URL on the way out of every JSON response, so no response path can
// forget to sign, and legacy rows need no data migration.

// Only these response keys are ever rewritten. The stored value must also
// parse as one of this app's own references (parseRef below) — anything else
// (a GitHub/LinkedIn avatar URL, a user-typed link) passes through untouched.
const MEDIA_FIELDS = new Set(['avatar_url', 'cover_image_url', 'profilePhoto', 'signature']);

// Object-name prefixes this module may sign. Anything else in the same
// bucket (e.g. placement-proof/ offer letters, when GCS_DOCUMENTS_BUCKET_NAME
// falls back to this bucket) is never signed here, even if a value somehow
// points at it.
const SIGNABLE_PREFIXES = ['student-profile/', 'profile/'];

const LOCAL_URL_PREFIX = '/uploads/profile/';
const GCS_PUBLIC_HOST = 'https://storage.googleapis.com/';
const SAFE_OBJECT_NAME = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;

function stripQuery(value) {
  return value.split(/[?#]/)[0];
}

function isSignableObjectPath(objectPath) {
  const prefix = SIGNABLE_PREFIXES.find((p) => objectPath.startsWith(p));
  return Boolean(prefix) && SAFE_OBJECT_NAME.test(objectPath.slice(prefix.length));
}

// Returns { kind: 'gcs', bucket, objectPath } | { kind: 'local', filename } | null.
function parseRef(value) {
  if (typeof value !== 'string' || !value) return null;

  if (value.startsWith(LOCAL_URL_PREFIX)) {
    const filename = stripQuery(value).slice(LOCAL_URL_PREFIX.length);
    return SAFE_OBJECT_NAME.test(filename) ? { kind: 'local', filename } : null;
  }

  let bucketAndPath = null;
  if (value.startsWith('gs://')) bucketAndPath = value.slice('gs://'.length);
  else if (value.startsWith(GCS_PUBLIC_HOST)) bucketAndPath = stripQuery(value).slice(GCS_PUBLIC_HOST.length);
  if (!bucketAndPath || !env.gcs.bucketName) return null;

  const slash = bucketAndPath.indexOf('/');
  if (slash <= 0) return null;
  const bucket = bucketAndPath.slice(0, slash);
  const objectPath = bucketAndPath.slice(slash + 1);
  if (bucket !== env.gcs.bucketName || !isSignableObjectPath(objectPath)) return null;
  return { kind: 'gcs', bucket, objectPath };
}

function isPrivateMediaRef(value) {
  return parseRef(value) !== null;
}

function gcsRef(objectPath) {
  return `gs://${env.gcs.bucketName}/${objectPath}`;
}

// Signing a GCS URL on Cloud Run is a network call (IAM signBlob), so each
// signed URL is reused until half its lifetime has passed. That also keeps a
// given image's URL stable across page loads for a while, so the browser's
// cache actually gets hits.
const MAX_CACHE_ENTRIES = 10000;
const cache = new Map();

async function signGcs(bucket, objectPath) {
  const key = `${bucket}/${objectPath}`;
  const ttlMs = env.gcs.mediaUrlTtlSeconds * 1000;
  const hit = cache.get(key);
  if (hit && hit.expiresAt - Date.now() > ttlMs / 2) return hit.url;

  const url = await signReadUrl({ bucketName: bucket, destination: objectPath, ttlSeconds: env.gcs.mediaUrlTtlSeconds });
  cache.delete(key);
  cache.set(key, { url, expiresAt: Date.now() + ttlMs });
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  return url;
}

// Resolves one reference to a URL the browser can load. A signing failure
// yields null (the image just doesn't render) rather than failing the whole
// response — and never falls back to the raw reference.
async function resolveRef(ref) {
  try {
    if (ref.kind === 'local') return signedUrl.sign(`${LOCAL_URL_PREFIX}${ref.filename}`, env.gcs.mediaUrlTtlSeconds);
    return await signGcs(ref.bucket, ref.objectPath);
  } catch (err) {
    logger.error('Failed to sign private media URL', { kind: ref.kind, error: err.message });
    return null;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Synchronous first pass: finds every media reference in a response body.
// Most responses contain none, and those are sent untouched without any
// copying or async work.
const MAX_DEPTH = 32;
function collectRefs(node, path, out, depth) {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectRefs(child, [...path, i], out, depth + 1));
  } else if (isPlainObject(node)) {
    for (const [key, child] of Object.entries(node)) {
      if (MEDIA_FIELDS.has(key)) {
        const ref = parseRef(child);
        if (ref) {
          out.push({ path: [...path, key], ref });
          continue;
        }
      }
      collectRefs(child, [...path, key], out, depth + 1);
    }
  }
}

// Copy-on-write: only the objects/arrays along each replaced path are
// shallow-copied, so the caller's original data (which may be cached
// elsewhere) is never mutated, and untouched branches aren't copied at all.
function applyReplacements(root, replacements) {
  const copies = new Map();
  const copyOf = (node) => {
    if (!copies.has(node)) copies.set(node, Array.isArray(node) ? [...node] : { ...node });
    return copies.get(node);
  };
  const newRoot = copyOf(root);
  for (const { path, value } of replacements) {
    let original = root;
    let copy = newRoot;
    for (const key of path.slice(0, -1)) {
      original = original[key];
      const childCopy = copyOf(original);
      copy[key] = childCopy;
      copy = childCopy;
    }
    copy[path[path.length - 1]] = value;
  }
  return newRoot;
}

async function signMediaInBody(body) {
  const found = [];
  collectRefs(body, [], found, 0);
  if (found.length === 0) return body;
  const urls = await Promise.all(found.map(({ ref }) => resolveRef(ref)));
  return applyReplacements(body, found.map(({ path }, i) => ({ path, value: urls[i] })));
}

function clearSignedUrlCache() {
  cache.clear();
}

module.exports = {
  MEDIA_FIELDS,
  LOCAL_URL_PREFIX,
  SAFE_OBJECT_NAME,
  parseRef,
  isPrivateMediaRef,
  gcsRef,
  signMediaInBody,
  clearSignedUrlCache,
};
