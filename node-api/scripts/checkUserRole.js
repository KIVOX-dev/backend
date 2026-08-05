// One-off diagnostic: prints a user's stored role/status by email.
// Read-only — makes no writes. Run with: node scripts/checkUserRole.js <email>
require('dotenv').config();
const { MongoClient } = require('mongodb');

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/checkUserRole.js <email>');
  process.exit(1);
}

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME);

  const users = await db.collection('users').find({ email: email.toLowerCase() }).toArray();
  console.log(`Matching users for ${email}: ${users.length}`);
  for (const u of users) {
    console.log({
      _id: u._id,
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      status: u.status,
      institution_id: u.institution_id,
      is_active: u.is_active,
      created_at: u.created_at,
    });
    if (u.role === 'student' || u.role === 'faculty') {
      const collectionName = u.role === 'student' ? 'students' : 'faculty';
      const linked = await db.collection(collectionName).findOne({ user_id: u._id });
      console.log(`  -> linked ${collectionName} row:`, linked || '(none)');
    }
  }

  await client.close();
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
