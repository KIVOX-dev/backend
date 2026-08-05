const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

describe('RBAC: self-service updates and institution-scoped approvals', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let hashPassword;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, hashPassword } = await buildTestApp());
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  async function login(email, password) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.data.accessToken;
  }

  // Regression test for H-4: Subscription.tsx's "Upgrade to Pro" does
  // PUT /users/:id (own id) with a `preferences` patch. This route used to
  // be gated to super_admin/institution_admin only, 403ing every student.
  it('lets a student self-update their own preferences (the upgrade flow) but not their role', async () => {
    const institution = await seedInstitution(institutionRepository);
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: 'student-self@example.com',
    });
    const token = await login(user.email, password);

    const res = await request(app)
      .put(`/api/v1/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ preferences: { plan: 'pro' } })
      .expect(200);
    expect(res.body.data.preferences.plan).toBe('pro');

    // Privilege escalation attempt via the same self-service path must be
    // silently dropped, not applied.
    const escalate = await request(app)
      .put(`/api/v1/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'super_admin', preferences: { plan: 'basic' } })
      .expect(200);
    expect(escalate.body.data.role).toBe('student');
    expect(escalate.body.data.preferences.plan).toBe('basic');
  });

  it('rejects a student updating a different user', async () => {
    const institution = await seedInstitution(institutionRepository);
    const { user: student, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: 'student-a@example.com',
    });
    const { user: other } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: 'student-b@example.com',
    });
    const token = await login(student.email, password);

    await request(app)
      .put(`/api/v1/users/${other.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ preferences: { plan: 'pro' } })
      .expect(403);
  });

  // Regression test for H-3: InstitutionalApproval.tsx (rendered on the
  // institution-admin portal) calls PUT /users/:id/approve — this used to be
  // super_admin-only, 403ing every institution admin trying to approve their
  // own pending HR/faculty signups.
  it('lets an institution_admin approve a pending user in their own institution', async () => {
    const institution = await seedInstitution(institutionRepository);
    const { user: admin, password: adminPassword } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: 'admin@example.com',
    });
    const { user: pendingHr } = await seedUser(userRepository, hashPassword, {
      role: 'hr',
      institutionId: institution.id,
      email: 'pending-hr@example.com',
      status: 'pending',
    });
    const token = await login(admin.email, adminPassword);

    const res = await request(app)
      .put(`/api/v1/users/${pendingHr.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.status).toBe('approved');
  });

  it('blocks an institution_admin from approving a user in a different institution', async () => {
    const institutionA = await seedInstitution(institutionRepository, { code: `A-${Date.now()}` });
    const institutionB = await seedInstitution(institutionRepository, { code: `B-${Date.now()}` });
    const { user: adminA, password: adminPassword } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institutionA.id,
      email: 'admin-a@example.com',
    });
    const { user: pendingInB } = await seedUser(userRepository, hashPassword, {
      role: 'hr',
      institutionId: institutionB.id,
      email: 'pending-b@example.com',
      status: 'pending',
    });
    const token = await login(adminA.email, adminPassword);

    await request(app)
      .put(`/api/v1/users/${pendingInB.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});
