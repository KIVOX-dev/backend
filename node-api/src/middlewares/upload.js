const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// Mirrors python-service's uploads/profile layout so both the on-disk path and
// the public /uploads/profile/<file> URL shape stay familiar across the migration.
const uploadDir = path.join(process.cwd(), 'uploads', 'profile');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

// 5MB/file cap is new (python-service had none at all). MIME/extension
// allow-listing is intentionally deferred to the Phase 5 security pass rather
// than added ad hoc here — this is a foundational-infra checkpoint, not where
// upload validation policy should get decided.
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

module.exports = { upload, uploadDir };
