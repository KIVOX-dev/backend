/* One-off: send the subscription thank-you email to users who paid before the
   email existed. Dry run by default (lists recipients, sends nothing).

     node scripts/sendSubscriptionThanks.js            # dry run
     node scripts/sendSubscriptionThanks.js --send     # actually send
     node scripts/sendSubscriptionThanks.js --send --email=a@b.com   # only this user

   Uses FRONTEND_URL and Brevo settings from the environment, so run it with the
   production values if the link in the email should point at production. */
require('dotenv').config();
const { MongoClient } = require('mongodb');
const env = require('../src/config/env');
const { PLANS } = require('../src/config/plans');
const { sendEmail } = require('../src/services/email.service');
const { subscriptionThanksTemplate } = require('../src/services/emailTemplates');

const send = process.argv.includes('--send');
const only = (process.argv.find((a) => a.startsWith('--email=')) || '').slice(8).toLowerCase();

(async () => {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db(process.env.MONGODB_DB_NAME);
  const payments = await db.collection('payments').find({ status: 'paid' }).sort({ paid_at: 1 }).toArray();
  console.log(`${payments.length} paid payment(s) found. Mode: ${send ? 'SEND' : 'DRY RUN'}`);

  for (const p of payments) {
    const plan = PLANS[p.plan_id];
    const user = await db.collection('users').findOne({ $or: [{ id: p.user_id }, { _id: p.user_id }] });
    if (!plan || !user?.email) { console.log(`- skip payment ${p.razorpay_order_id}: plan/user/email missing`); continue; }
    if (only && user.email.toLowerCase() !== only) continue;
    console.log(`- ${user.email} | ${plan.label} | paid ${p.paid_at?.toISOString?.()} | until ${p.plan_expires_at?.toISOString?.()}`);
    if (!send) continue;
    const { subject, html, text } = subscriptionThanksTemplate({
      fullName: user.full_name,
      months: plan.months,
      amountPaise: p.amount,
      expiresAt: new Date(user.preferences?.plan_expires_at || p.plan_expires_at),
      dashboardUrl: `${env.frontendUrl.replace(/\/$/, '')}${user.role === 'hr' ? '/hr' : '/learner'}`,
    });
    console.log('   ->', JSON.stringify(await sendEmail({ to: user.email, subject, html, text })));
  }
  await client.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
