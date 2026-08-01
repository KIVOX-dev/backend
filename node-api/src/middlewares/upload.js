const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

// Mirrors python-service's uploads/profile layout so both the on-disk path and
// the public /uploads/profile/<file> URL shape stay familiar across the migration.
const uploadDir = path.join(process.cwd(), 'uploads', 'profile');
fs.mkdirSync(uploadDir, { recursive: true });

// Every upload field in the app (onboardingSchemas.js's `profilePhoto` and
// `signature`) is an image — this endpoint has never needed anything else,
// so the allow-list is intentionally image-only rather than a general
// "safe file types" list. Two layers, both required:
//   1. extension + declared Content-Type, checked here (multer fileFilter) —
//      cheap, rejects the obvious case before any bytes are read.
//   2. magic-byte signature, checked in verifyAndPersist below, against the
//      actual uploaded bytes — the declared MIME type/extension are just
//      what the client claims and are trivial to lie about (rename
//      shell.php.jpg, or set Content-Type: image/png on an .exe); only the
//      file's real header proves what it is.
const ALLOWED_TYPES = {
  'image/jpeg': { extensions: ['.jpg', '.jpeg'], magic: (buf) => buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff },
  'image/png': {
    extensions: ['.png'],
    magic: (buf) => buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  'image/gif': {
    extensions: ['.gif'],
    magic: (buf) => buf.slice(0, 6).equals(Buffer.from('GIF87a', 'ascii')) || buf.slice(0, 6).equals(Buffer.from('GIF89a', 'ascii')),
  },
  'image/webp': {
    extensions: ['.webp'],
    magic: (buf) => buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP',
  },
  // SVG is deliberately excluded even though it's "an image format" — it can
  // embed <script>/event-handler payloads and this app serves uploads back
  // statically (see app.js's /uploads static mount), which would make this
  // a stored-XSS vector.
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function extensionOf(originalname) {
  return path.extname(originalname || '').toLowerCase();
}

// multer's fileFilter only sees what the client claims (originalname,
// mimetype) before any bytes arrive — it cannot see file content. It exists
// to reject obviously-wrong uploads cheaply; verifyAndPersist below is what
// actually proves the content matches.
function fileFilter(req, file, cb) {
  const rule = ALLOWED_TYPES[file.mimetype];
  const ext = extensionOf(file.originalname);
  if (!rule || !rule.extensions.includes(ext)) {
    cb(ApiError.badRequest(`Unsupported file type for "${file.fieldname}". Allowed: JPEG, PNG, GIF, WEBP images.`));
    return;
  }
  cb(null, true);
}

// Buffered in memory (capped at MAX_FILE_BYTES — small enough that this is
// safe) rather than streamed straight to disk, specifically so the magic-byte
// check below can run — and reject — *before* anything attacker-controlled
// ever touches the filesystem.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter,
});

// Runs after upload.any() on the same route. Verifies each buffered file's
// real content against its declared type, then — and only then — writes it
// to disk under a fresh random filename (never the client-supplied
// originalname, which is how path traversal / double-extension tricks like
// `avatar.jpg.php` would otherwise reach the filesystem). Sets `file.filename`
// on each entry so downstream controllers (profile.controller.js#saveOwn)
// keep working unchanged.
const verifyAndPersist = asyncHandler(async (req, res, next) => {
  for (const file of req.files || []) {
    const rule = ALLOWED_TYPES[file.mimetype];
    if (!rule || !rule.magic(file.buffer)) {
      throw ApiError.badRequest(`"${file.originalname}" does not look like a valid ${file.mimetype.split('/')[1].toUpperCase()} file.`);
    }
    const ext = extensionOf(file.originalname);
    file.filename = `${crypto.randomUUID()}${ext}`;
    await fs.promises.writeFile(path.join(uploadDir, file.filename), file.buffer);
  }
  next();
});

module.exports = { upload, uploadDir, verifyAndPersist };
