# Testing the email auth flows (Postman / curl)

Base URL: `http://localhost:5000/api/v1` (adjust `PORT`/`API_PREFIX` if changed).
All three endpoints share the same `authLimiter` as `/auth/login` (20 requests / 15 min per IP).

## 1. POST /auth/forgot-password

**Request**
```
POST /auth/forgot-password
Content-Type: application/json

{
  "email": "student@example.com"
}
```

**Response — 200, identical whether or not the account exists (see authService.js#forgotPassword for why):**
```json
{
  "success": true,
  "message": "If an account exists for that email, a password reset link has been sent.",
  "data": null
}
```

**Response — 400, invalid email format:**
```json
{
  "success": false,
  "message": "Validation failed",
  "data": ["\"email\" must be a valid email"]
}
```

If `BREVO_API_KEY`/`BREVO_SENDER_EMAIL` aren't configured, the request still
returns 200 (nothing about the response reveals whether the email actually
sent) — check the server logs for `Email not sent — Brevo is not configured`.

---

## 2. POST /auth/reset-password

Get a real token by requesting a password reset above, then reading
`reset_password_token_hash`'s *pre-hash* value from the email link
(`FRONTEND_URL/reset-password?token=<raw token>`) — the raw token, not the
hash stored in MongoDB.

**Request**
```
POST /auth/reset-password
Content-Type: application/json

{
  "token": "<raw token from the emailed link>",
  "newPassword": "a-new-strong-password-123"
}
```

**Response — 200:**
```json
{
  "success": true,
  "message": "Password has been reset. Please log in with your new password.",
  "data": null
}
```

**Response — 400, invalid/expired/already-used token:**
```json
{
  "success": false,
  "message": "This reset link is invalid or has expired",
  "data": null
}
```

**Response — 400, password too short:**
```json
{
  "success": false,
  "message": "Validation failed",
  "data": ["\"newPassword\" length must be at least 8 characters long"]
}
```

After a successful reset, any refresh token issued before the reset (e.g. one
saved in another browser tab) will fail on its next `POST /auth/refresh` with
401 `Session no longer valid, please log in again` — see the `token_version`
mechanism in `authService.js`.

---

## 3. GET /auth/verify-email

**Request**
```
GET /auth/verify-email?token=<raw token from the emailed link>
```

**Response — 200:**
```json
{
  "success": true,
  "message": "Email verified successfully.",
  "data": null
}
```

**Response — 400, invalid/expired/already-used token:**
```json
{
  "success": false,
  "message": "This verification link is invalid or has expired",
  "data": null
}
```

A verification token is issued automatically on `POST /auth/register` and
expires after 15 minutes (`VERIFICATION_TOKEN_TTL_MINUTES` in `authService.js`).

---

## Local setup checklist

1. In `.env.node`, set `BREVO_API_KEY` (already added), `BREVO_SENDER_EMAIL`
   to a verified sender identity in your Brevo account, and `BREVO_SENDER_NAME`.
2. `FRONTEND_URL` controls the link host in both emails — point it at
   wherever `/reset-password` and `/verify-email` are actually handled.
3. Without a configured sender, both flows still return their normal success
   responses (never revealing send failure to the client) — confirm the
   email attempt via server logs, not the HTTP response.
