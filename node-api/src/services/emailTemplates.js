// Plain HTML string templates, not a templating engine — there are only two
// of these and they don't need conditionals/loops, so a dependency (handlebars,
// ejs, etc.) would be pure overhead. Table-based layout + inline styles is
// deliberate: it's the one HTML dialect that renders consistently across
// Outlook/Gmail/Apple Mail, which all strip or ignore <style> blocks to
// varying degrees.
function baseLayout({ preheader, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>UpScaler-AI</title>
  </head>
  <body style="margin:0; padding:0; background-color:#F3F6FA; font-family:Arial, Helvetica, sans-serif;">
    <span style="display:none; max-height:0; overflow:hidden;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F6FA; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; border:1px solid #E1E7EF;">
            <tr>
              <td style="padding:28px 32px 0;">
                <!-- Logo placeholder: swap for an <img> once a hosted logo asset exists -->
                <div style="font-size:20px; font-weight:700; color:#164A61;">UpScaler-AI</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px; color:#1A2430; font-size:15px; line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
            <tr>
              <td style="padding:16px 32px; color:#8A97A8; font-size:12px; text-align:center;">
                UpScaler-AI Platform &mdash; this is an automated message, please don't reply directly to it.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="border-radius:8px; background-color:#2C6E8E;">
        <a href="${href}" target="_blank" style="display:inline-block; padding:12px 28px; color:#FFFFFF; text-decoration:none; font-size:15px; font-weight:600; border-radius:8px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

function passwordResetTemplate({ fullName, resetUrl, expiresInMinutes = 15 }) {
  const greeting = fullName ? `Hi ${fullName},` : 'Hi,';
  const html = baseLayout({
    preheader: 'Reset your UpScaler-AI password',
    bodyHtml: `
      <p style="margin:0 0 12px; font-size:17px; font-weight:600;">Reset your password</p>
      <p style="margin:0 0 4px;">${greeting}</p>
      <p style="margin:0 0 4px;">We received a request to reset the password for your UpScaler-AI account. Click the button below to choose a new one.</p>
      ${button(resetUrl, 'Reset Password')}
      <p style="margin:0 0 4px; color:#54637A; font-size:13px;">This link expires in ${expiresInMinutes} minutes.</p>
      <p style="margin:16px 0 0; color:#54637A; font-size:13px;">If you didn't request this, you can safely ignore this email — your password won't be changed.</p>
    `,
  });

  const text = `${greeting}

We received a request to reset the password for your UpScaler-AI account.

Reset your password here: ${resetUrl}

This link expires in ${expiresInMinutes} minutes.

If you didn't request this, you can safely ignore this email — your password won't be changed.`;

  return { subject: 'Reset your UpScaler-AI password', html, text };
}

function verificationTemplate({ fullName, verifyUrl, expiresInMinutes = 15 }) {
  const greeting = fullName ? `Hi ${fullName},` : 'Hi,';
  const html = baseLayout({
    preheader: 'Verify your email to finish setting up your UpScaler-AI account',
    bodyHtml: `
      <p style="margin:0 0 12px; font-size:17px; font-weight:600;">Welcome to UpScaler-AI</p>
      <p style="margin:0 0 4px;">${greeting}</p>
      <p style="margin:0 0 4px;">Thanks for signing up. Confirm your email address to activate your account.</p>
      ${button(verifyUrl, 'Verify Email')}
      <p style="margin:0 0 4px; color:#54637A; font-size:13px;">This link expires in ${expiresInMinutes} minutes.</p>
      <p style="margin:16px 0 0; color:#54637A; font-size:13px;">If you didn't create a UpScaler-AI account, you can ignore this email.</p>
    `,
  });

  const text = `${greeting}

Thanks for signing up for UpScaler-AI. Confirm your email address to activate your account.

Verify your email here: ${verifyUrl}

This link expires in ${expiresInMinutes} minutes.

If you didn't create a UpScaler-AI account, you can ignore this email.`;

  return { subject: 'Verify your UpScaler-AI email', html, text };
}

function studentWelcomeTemplate({ fullName, email, tempPassword, loginUrl }) {
  const greeting = fullName ? `Hi ${fullName},` : 'Hi,';
  const html = baseLayout({
    preheader: 'Your UpScaler-AI account is ready — set your password to get started',
    bodyHtml: `
      <p style="margin:0 0 12px; font-size:17px; font-weight:600;">Welcome to UpScaler-AI</p>
      <p style="margin:0 0 4px;">${greeting}</p>
      <p style="margin:0 0 4px;">An account has been created for you. Use these temporary credentials to log in — you'll be asked to set your own password on first login.</p>
      <p style="margin:16px 0 4px; padding:12px 16px; background-color:#F3F6FA; border-radius:8px; font-family:monospace;">
        Email: ${email}<br />
        Temporary password: ${tempPassword}
      </p>
      ${button(loginUrl, 'Log In')}
      <p style="margin:16px 0 0; color:#54637A; font-size:13px;">This temporary password only works until you set a new one — it cannot be reused after that.</p>
    `,
  });

  const text = `${greeting}

An account has been created for you on UpScaler-AI.

Email: ${email}
Temporary password: ${tempPassword}

Log in here: ${loginUrl}

You'll be asked to set your own password on first login. This temporary password cannot be reused after that.`;

  return { subject: 'Your UpScaler-AI account is ready', html, text };
}

module.exports = { passwordResetTemplate, verificationTemplate, studentWelcomeTemplate };
