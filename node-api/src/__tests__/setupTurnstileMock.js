// Global Jest setup — applied to every test file (see jest.config.js's
// setupFiles). /auth/login is hit directly by ~20 integration test files
// that have nothing to do with Turnstile (they're testing RBAC, pagination,
// uploads, etc. and just need a logged-in session to get there); requiring
// each of them to also fabricate a valid Turnstile token would be pure
// noise. Auto-mocking the service here means every real call in
// middlewares/verifyTurnstile.js resolves as verified, everywhere, without
// touching those files or making a real network call to Cloudflare.
//
// auth.test.js declares its own local jest.mock() for this same module
// (needed there regardless, since it also asserts specific
// register/forgot-password behavior) — a local jest.mock() in a test file
// takes precedence over this one for that file, so there's no conflict.
jest.mock('../services/turnstile.service', () => ({
  verifyToken: jest.fn().mockResolvedValue({ success: true }),
}));
