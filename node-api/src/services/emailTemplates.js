// Plain HTML string templates, not a templating engine — there are only two
// of these and they don't need conditionals/loops, so a dependency (handlebars,
// ejs, etc.) would be pure overhead. Table-based layout + inline styles is
// deliberate: it's the one HTML dialect that renders consistently across
// Outlook/Gmail/Apple Mail, which all strip or ignore <style> blocks to
// varying degrees.
// Email clients can't reach localhost, so the logo is always the public
// production asset (served from the frontend's /public/brand/).
const LOGO_URL = 'https://www.talentsnaps.com/brand/lockup.png';
// Hero backgrounds live in the frontend's public/email/ (hero-<variant>.png).
// Override the host to preview unpublished images locally.
const ASSET_BASE = process.env.EMAIL_ASSET_BASE_URL || 'https://www.talentsnaps.com';
const SUPPORT_EMAIL = 'admin@talentsnaps.com';

// Same visual design as docs/email-templates/test-assigned.html (the Brevo
// template), so every email the platform sends looks like one family.
function baseLayout({ preheader, eyebrow, title, hero = 'security', bodyHtml }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>TalentSnaps</title>
    <style>
      body { margin: 0; padding: 0; background: #ffffff; }
      table { border-collapse: collapse; }
      img { border: 0; }
      @media only screen and (max-width: 520px) {
        .container { width: 100% !important; }
        .pad { padding-left: 20px !important; padding-right: 20px !important; }
        .hero-title { font-size: 26px !important; line-height: 32px !important; }
        .hero-inner { padding: 22px 16px !important; }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background:#ffffff; font-family:Inter,'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:#ffffff;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
      <tr>
        <td align="center" style="padding:12px 12px 0;">
          <table role="presentation" class="container" width="480" cellpadding="0" cellspacing="0" style="width:480px; max-width:100%;">
            <tr>
              <td align="center" style="padding:26px 0 22px;">
                <img src="${LOGO_URL}" alt="TalentSnaps" width="190" style="display:block; width:190px; max-width:100%; height:auto; border:0;" />
              </td>
            </tr>
            <tr>
              <td class="pad" background="${ASSET_BASE}/email/hero-${hero}.png" bgcolor="#1b0f6b" style="background-color:#1b0f6b; background-image:url('${ASSET_BASE}/email/hero-${hero}.png'), linear-gradient(135deg,#050312 0%,#1b0f6b 55%,#2a1a9e 100%); background-size:cover; background-position:center; border-radius:24px 24px 0 0; padding:30px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="hero-inner" align="center" style="border:1px solid rgba(255,255,255,0.22); background:rgba(255,255,255,0.07); border-radius:18px; padding:30px 24px;">
                      <div style="font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:#b9b4f5; padding-bottom:10px;">${eyebrow}</div>
                      <div class="hero-title" style="font-size:30px; line-height:36px; font-weight:700; color:#ffffff;">${title}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="pad" style="background:#f4f4f6; border-radius:0 0 24px 24px; padding:28px 34px 34px; font-size:15px; line-height:22px; color:#6b6b7a;">
                ${bodyHtml}
              </td>
            </tr>
            <tr><td style="height:36px; line-height:36px; font-size:0;">&nbsp;</td></tr>
            <tr>
              <td class="pad" align="center" style="background:#f4f4f6; border-radius:24px; padding:26px 28px 22px; font-size:12px; line-height:19px; color:#6b6b7a;">
                <p style="margin:0 0 12px;">This is an automated message from TalentSnaps &mdash; please don't reply directly to it.</p>
                <p style="margin:0 0 12px;">Need help? Contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b4cf0; text-decoration:none;">${SUPPORT_EMAIL}</a></p>
                <p style="margin:0;">&copy; TalentSnaps. All rights reserved.</p>
              </td>
            </tr>
            <tr><td style="height:24px; line-height:24px; font-size:0;">&nbsp;</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(href, label) {
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:24px auto;">
    <tr>
      <td align="center" style="background:#1f3bff; border-radius:999px;">
        <a href="${href}" target="_blank" style="display:inline-block; padding:13px 30px; color:#ffffff; text-decoration:none; font-size:15px; font-weight:600;">${label}</a>
      </td>
    </tr>
  </table>
  <p style="margin:0 0 4px; font-size:12px; line-height:18px; color:#8a8a98; text-align:center;">Button not working? Copy this link into your browser:<br /><a href="${href}" style="color:#3b4cf0; word-break:break-all;">${href}</a></p>`;
}

function passwordResetTemplate({ fullName, resetUrl, expiresInMinutes = 15 }) {
  const greeting = fullName ? `Hi ${fullName},` : 'Hi,';
  const html = baseLayout({
    hero: 'security',
    eyebrow: 'Account security',
    title: 'Reset your<br />password',
    preheader: 'Reset your TalentSnaps password',
    bodyHtml: `
      <p style="margin:0 0 14px;">${greeting}</p>
      <p style="margin:0 0 14px;">We received a request to reset the password for your TalentSnaps account. Click the button below to choose a new one.</p>
      ${button(resetUrl, 'Reset Password')}
      <p style="margin:0 0 4px; color:#8a8a98; font-size:13px;">This link expires in ${expiresInMinutes} minutes.</p>
      <p style="margin:16px 0 0; color:#8a8a98; font-size:13px;">If you didn't request this, you can safely ignore this email — your password won't be changed.</p>
    `,
  });

  const text = `${greeting}

We received a request to reset the password for your TalentSnaps account.

Reset your password here: ${resetUrl}

This link expires in ${expiresInMinutes} minutes.

If you didn't request this, you can safely ignore this email — your password won't be changed.

Need help? Contact us at ${SUPPORT_EMAIL}`;

  return { subject: 'Reset your TalentSnaps password', html, text };
}

function verificationTemplate({ fullName, verifyUrl, expiresInMinutes = 15 }) {
  const greeting = fullName ? `Hi ${fullName},` : 'Hi,';
  const html = baseLayout({
    hero: 'verify',
    eyebrow: 'Verify email',
    title: 'Confirm your<br />email address',
    preheader: 'Verify your email to finish setting up your TalentSnaps account',
    bodyHtml: `
      <p style="margin:0 0 14px;">${greeting}</p>
      <p style="margin:0 0 14px;">Thanks for signing up. Confirm your email address to activate your account.</p>
      ${button(verifyUrl, 'Verify Email')}
      <p style="margin:0 0 4px; color:#8a8a98; font-size:13px;">This link expires in ${expiresInMinutes} minutes.</p>
      <p style="margin:16px 0 0; color:#8a8a98; font-size:13px;">If you didn't create a TalentSnaps account, you can ignore this email.</p>
    `,
  });

  const text = `${greeting}

Thanks for signing up for TalentSnaps. Confirm your email address to activate your account.

Verify your email here: ${verifyUrl}

This link expires in ${expiresInMinutes} minutes.

If you didn't create a TalentSnaps account, you can ignore this email.

Need help? Contact us at ${SUPPORT_EMAIL}`;

  return { subject: 'Verify your TalentSnaps email', html, text };
}

function studentWelcomeTemplate({ fullName, email, tempPassword, loginUrl }) {
  const greeting = fullName ? `Hi ${fullName},` : 'Hi,';
  const html = baseLayout({
    hero: 'welcome',
    eyebrow: 'Welcome',
    title: 'Your account<br />is ready',
    preheader: 'Your TalentSnaps account is ready — set your password to get started',
    bodyHtml: `
      <p style="margin:0 0 14px;">${greeting}</p>
      <p style="margin:0 0 14px;">An account has been created for you. Use these temporary credentials to log in — you'll be asked to set your own password on first login.</p>
      <p style="margin:16px 0 4px; padding:16px 18px; background-color:#ffffff; border-radius:14px; font-family:monospace; color:#1a1a2e;">
        Email: ${email}<br />
        Temporary password: ${tempPassword}
      </p>
      ${button(loginUrl, 'Log In')}
      <p style="margin:16px 0 0; color:#8a8a98; font-size:13px;">This temporary password only works until you set a new one — it cannot be reused after that.</p>
    `,
  });

  const text = `${greeting}

An account has been created for you on TalentSnaps.

Email: ${email}
Temporary password: ${tempPassword}

Log in here: ${loginUrl}

You'll be asked to set your own password on first login. This temporary password cannot be reused after that.

Need help? Contact us at ${SUPPORT_EMAIL}`;

  return { subject: 'Your TalentSnaps account is ready', html, text };
}

module.exports = { passwordResetTemplate, verificationTemplate, studentWelcomeTemplate };
