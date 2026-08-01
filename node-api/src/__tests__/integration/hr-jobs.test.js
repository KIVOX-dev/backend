const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression tests for C-2: the live HR portal (hr/page.tsx) calls /jobs,
// /jobs/me, /jobs/applications/me and POSTs to /jobs — none of which existed
// before /jobs was aliased onto the placement router.
describe('HR portal: /jobs alias and payload shape', () => {
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

  async function loginAsHr() {
    const institution = await seedInstitution(institutionRepository);
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'hr',
      institutionId: institution.id,
      email: `hr-${Date.now()}@example.com`,
    });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    return res.body.data.accessToken;
  }

  it('accepts a vacancy post at /jobs with the frontend\'s actual payload shape (comma-separated strings)', async () => {
    const token = await loginAsHr();

    const res = await request(app)
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Full Stack Developer',
        job_type: 'full_time',
        application_deadline: new Date(Date.now() + 86400000).toISOString(),
        min_cgpa: 7,
        eligible_years: '2024, 2025',
        description: 'Build things.',
        required_skills: 'React, Node.js',
        company_name: 'Acme Corp',
      })
      .expect(201);

    expect(res.body.data.title).toBe('Full Stack Developer');
    expect(res.body.data.required_skills).toEqual(['React', 'Node.js']);
    expect(res.body.data.eligible_years).toEqual([2024, 2025]);
  });

  it('lists postings under /jobs and /placements identically', async () => {
    const token = await loginAsHr();
    await request(app)
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Backend Engineer', company_name: 'Acme' })
      .expect(201);

    const viaJobs = await request(app).get('/api/v1/jobs/me').set('Authorization', `Bearer ${token}`).expect(200);
    const viaPlacements = await request(app)
      .get('/api/v1/placements/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(viaJobs.body.data)).toBe(true);
    expect(viaJobs.body.data.map((p) => p.id).sort()).toEqual(viaPlacements.body.data.map((p) => p.id).sort());
  });

  it('/jobs/applications/me responds for a recruiter (empty, but not 404)', async () => {
    const token = await loginAsHr();
    const res = await request(app)
      .get('/api/v1/jobs/applications/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
