import os

# Settings() (see app/config.py) requires JWT_SECRET_KEY with no default and
# reads from a local .env file that is gitignored and won't exist in CI —
# set the required values directly so the test suite doesn't depend on any
# machine-local file.
os.environ.setdefault("JWT_SECRET_KEY", "test-only-secret-key-not-for-production-use-1234")
os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017")
os.environ.setdefault("MONGODB_DB_NAME", "upscaler_ai_test")
os.environ.setdefault("SUPER_ADMIN_EMAIL", "admin@example.com")
os.environ.setdefault("SUPER_ADMIN_PASSWORD", "test-only-admin-password")
