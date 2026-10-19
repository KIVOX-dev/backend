const env = require('../../config/env');
const { DEFAULT_STUDENT_PASSWORD } = require('../../config/constants');

// Welcome email for a newly onboarded student. The scope's entity is the
// institution they joined (every student is onboarded into exactly one), so
// "resend failed onboarding emails" is one call per institution.
//
// The password is never stored with the notification. A student is shown the
// default password only if they were given it and have not logged in since —
// otherwise tempPassword is "" and the template tells them to use the password
// their administrator gave them.
module.exports = {
  entityType: 'institution',
  eventType: 'account_created',
  async load() {
    return { params: { loginUrl: `${env.frontendUrl.replace(/\/$/, '')}/institutional` } };
  },
  rowParams(ctx, { user, row }) {
    const stillDefault = row.uses_default_password === true && !user.last_login_at;
    return {
      studentName: user.full_name || 'Student',
      email: user.email,
      tempPassword: stillDefault ? DEFAULT_STUDENT_PASSWORD : '',
    };
  },
};
