const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// End-to-end coverage of the HR portal features: pipeline, interviews,
// evaluation, matching, talent pool, analytics, dashboard and employees.
describe('HR portal', () => {
  let app;
  let database;
  let repos;
  let hashPassword;
  let institution;
  let hrToken;
  let otherHrToken;
  let adminToken;
  const students = {};
  let placement;
  const appIds = {};
  let interview;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (user, password) => (await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200)).body.data.accessToken;
  const get = (url, t = hrToken) => request(app).get(`/api/v1/hr${url}`).set(auth(t));
  const post = (url, body, t = hrToken) => request(app).post(`/api/v1/hr${url}`).set(auth(t)).send(body);
  const patch = (url, body, t = hrToken) => request(app).patch(`/api/v1/hr${url}`).set(auth(t)).send(body);
  const put = (url, body, t = hrToken) => request(app).put(`/api/v1/hr${url}`).set(auth(t)).send(body);
  const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

  async function seedStudent(key, { cgpa, skills, months = 0 }) {
    const { user, password } = await seedUser(repos.userRepository, hashPassword, {
      role: 'student', institutionId: institution.id, email: `${key}-${Date.now()}@example.com`, full_name: `Student ${key}`, department: 'CSE',
    });
    const student = await repos.studentRepository.create({
      user_id: user.id, institution_id: institution.id, roll_number: `R-${key}-${Date.now()}`, cgpa, batch_year: 2025, profile_completed: true,
      work_experience: months ? [{ id: '1', jobTitle: 'Dev', companyName: 'X', workMode: 'remote', workType: 'internship', startMonth: 1, startYear: 2024, endMonth: months, endYear: 2024, description: 'Built React apps' }] : [],
    });
    await require('../../repositories/resumeBuilder.repository').create({ student_id: student.id, institution_id: institution.id, skills: skills.map((name) => ({ name })), objective: `Developer who likes ${skills.join(' ')}` });
    students[key] = { user, password, student, token: await login(user, password) };
  }

  beforeAll(async () => {
    ({ app, database, hashPassword, ...repos } = await buildTestApp());
    institution = await seedInstitution(repos.institutionRepository);
    const hr = await seedUser(repos.userRepository, hashPassword, { role: 'hr', institutionId: institution.id, email: `hr1-${Date.now()}@example.com`, full_name: 'HR One' });
    const hr2 = await seedUser(repos.userRepository, hashPassword, { role: 'hr', institutionId: institution.id, email: `hr2-${Date.now()}@example.com`, full_name: 'HR Two' });
    const admin = await seedUser(repos.userRepository, hashPassword, { role: 'institution_admin', institutionId: institution.id, email: `adm-${Date.now()}@example.com` });
    hrToken = await login(hr.user, hr.password);
    otherHrToken = await login(hr2.user, hr2.password);
    adminToken = await login(admin.user, admin.password);

    await seedStudent('strong', { cgpa: 8.5, skills: ['ReactJS', 'Node.js', 'MongoDB'], months: 8 });
    await seedStudent('weak', { cgpa: 7.2, skills: ['Photoshop'] });
    await seedStudent('mid', { cgpa: 7.8, skills: ['React', 'Python'] });
    await seedStudent('extra', { cgpa: 9, skills: ['React', 'Node', 'MongoDB', 'Docker'], months: 10 });

    const res = await request(app).post('/api/v1/jobs').set(auth(hrToken)).send({
      title: 'Full Stack Developer', status: 'open', job_type: 'full_time', description: 'Build React and Node.js apps backed by MongoDB.',
      required_skills: 'React, Node.js, MongoDB, Docker', min_cgpa: 7, min_experience_years: 0.5, company_name: 'Acme',
      application_deadline: inHours(24 * 20),
    }).expect(201);
    placement = res.body.data;
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  describe('access control', () => {
    it('blocks non-HR roles and unauthenticated callers from portal routes', async () => {
      await get('/dashboard', adminToken).expect(403);
      await get('/employees', adminToken).expect(403);
      await request(app).get('/api/v1/hr/dashboard').expect(401);
    });

    it('still lets institution_admin read the legacy HR profile list', async () => {
      await request(app).get('/api/v1/hr').set(auth(adminToken)).expect(200);
    });
  });

  describe('candidate pipeline', () => {
    it('records students applying with source and history', async () => {
      for (const key of ['strong', 'weak', 'mid', 'extra']) {
        const res = await request(app).post('/api/v1/placement-applications').set(auth(students[key].token)).send({ placement_id: placement.id }).expect(201);
        appIds[key] = res.body.data.id;
        expect(res.body.data.source).toBe('direct_application');
        expect(res.body.data.recruiter_id).toBe(placement.recruiter_id);
      }
    });

    it('lists applicants with filters and search', async () => {
      const all = await get('/applications').expect(200);
      expect(all.body.meta.total).toBe(4);
      expect(all.body.data[0].candidate.full_name).toMatch(/Student/);
      const found = await get('/applications?search=strong').expect(200);
      expect(found.body.data.map((a) => a.id)).toEqual([appIds.strong]);
      const none = await get('/applications?status=hired').expect(200);
      expect(none.body.meta.total).toBe(0);
    });

    it('moves a candidate through stages, writing history and notifying the student', async () => {
      await patch(`/applications/${appIds.strong}/stage`, { status: 'screening' }).expect(200);
      const res = await patch(`/applications/${appIds.strong}/stage`, { status: 'shortlisted', note: 'Great portfolio' }).expect(200);
      expect(res.body.data.status).toBe('shortlisted');
      expect(res.body.data.shortlisted_at).toBeTruthy();
      expect(res.body.data.stage_history.map((h) => h.to)).toEqual(['applied', 'screening', 'shortlisted']);

      const notes = await request(app).get('/api/v1/notifications').set(auth(students.strong.token)).expect(200);
      expect(notes.body.data.some((n) => /shortlisted/i.test(n.title))).toBe(true);
    });

    it('stops another recruiter from touching the application', async () => {
      await patch(`/applications/${appIds.strong}/stage`, { status: 'selected' }, otherHrToken).expect(403);
      await get(`/applications/${appIds.strong}`, otherHrToken).expect(403);
      // the legacy status endpoint is guarded too (previously any HR could move any application)
      await request(app).patch(`/api/v1/placement-applications/${appIds.strong}/status`).set(auth(otherHrToken)).send({ status: 'selected' }).expect(403);
    });

    it('bulk-moves and reports per-application outcomes; rejection stores a reason', async () => {
      const res = await post('/applications/bulk-stage', { application_ids: [appIds.weak, '00000000-0000-4000-8000-000000000000'], status: 'rejected', reason: 'Skills gap' }).expect(200);
      expect(res.body.data).toMatchObject({ moved: 1, failed: 1 });
      const detail = await get(`/applications/${appIds.weak}`).expect(200);
      expect(detail.body.data.rejection_reason).toBe('Skills gap');
    });

    it('serves a kanban board with stage columns and counts', async () => {
      const res = await get(`/pipeline/${placement.id}`).expect(200);
      expect(res.body.data.stages).toEqual(['applied', 'screening', 'shortlisted', 'interview', 'selected', 'hired', 'rejected']);
      expect(res.body.data.counts).toMatchObject({ shortlisted: 1, rejected: 1, applied: 2, total: 4 });
      expect(res.body.data.columns.shortlisted[0].id).toBe(appIds.strong);
    });

    it('rejects an unknown stage', async () => {
      await patch(`/applications/${appIds.strong}/stage`, { status: 'teleported' }).expect(400);
    });
  });

  describe('AI candidate matching', () => {
    it('scores a resume against the job description', async () => {
      const res = await get(`/matching/application/${appIds.strong}`).expect(200);
      const d = res.body.data;
      expect(d.skill_match_percent).toBe(75);
      expect(d.matched_skills).toEqual(expect.arrayContaining(['React', 'Node.js', 'MongoDB']));
      expect(d.missing_skills).toEqual(['Docker']);
      expect(d.match_score).toBeGreaterThan(50);
      expect(d.eligible).toBe(true);
    });

    it('ranks applicants by match', async () => {
      const res = await get(`/matching/vacancy/${placement.id}/applicants`).expect(200);
      const order = res.body.data.map((r) => r.application_id);
      expect(order[0]).toBe(appIds.extra);
      expect(order[order.length - 1]).toBe(appIds.weak);
    });

    it('recommends platform candidates, hiding contact details of strangers', async () => {
      await seedStudent('stranger', { cgpa: 8, skills: ['React', 'Node.js', 'MongoDB', 'Docker'], months: 12 });
      const res = await get(`/matching/vacancy/${placement.id}/recommended?scope=platform&min_score=40`).expect(200);
      const stranger = res.body.data.candidates.find((c) => c.student_id === students.stranger.student.id);
      expect(stranger).toBeTruthy();
      expect(stranger.already_applied).toBe(false);
      expect(stranger.email).toBeUndefined();
      const applicant = res.body.data.candidates.find((c) => c.student_id === students.strong.student.id);
      expect(applicant.email).toBeTruthy();
      expect(res.body.data.candidates.some((c) => c.student_id === students.weak.student.id)).toBe(false); // below min_score / ineligible skills
    });
  });

  describe('interview management', () => {
    it('schedules an interview, moves the candidate to Interview and notifies them', async () => {
      const res = await post('/interviews', {
        application_id: appIds.strong, scheduled_at: inHours(48), duration_minutes: 45, mode: 'online', meeting_link: 'https://meet.example.com/abc',
        interviewers: [{ name: 'Priya Nair', email: 'priya@acme.test' }, { name: 'Ravi', email: 'ravi@acme.test' }],
      }).expect(201);
      interview = res.body.data;
      expect(interview.round).toBe(1);
      expect(interview.status).toBe('scheduled');
      const detail = await get(`/applications/${appIds.strong}`).expect(200);
      expect(detail.body.data.status).toBe('interview');
      const notes = await request(app).get('/api/v1/notifications').set(auth(students.strong.token)).expect(200);
      expect(notes.body.data.some((n) => n.type === 'interview')).toBe(true);
    });

    it('detects clashes for the same panelist and for the same candidate', async () => {
      const clash = await post('/interviews', { application_id: appIds.extra, scheduled_at: inHours(48.25), interviewers: [{ name: 'Priya', email: 'PRIYA@acme.test' }] }).expect(409);
      expect(clash.body.code).toBe('SCHEDULE_CONFLICT');
      expect(clash.body.details || clash.body.errors || clash.body).toBeTruthy();
      await post('/interviews', { application_id: appIds.strong, scheduled_at: inHours(48.5) }).expect(409);
      // different slot is fine; force overrides
      await post('/interviews', { application_id: appIds.extra, scheduled_at: inHours(60), interviewers: [{ name: 'Priya', email: 'priya@acme.test' }] }).expect(201);
      await post('/interviews', { application_id: appIds.mid, scheduled_at: inHours(48.25), interviewers: [{ name: 'Ravi', email: 'ravi@acme.test' }], force: true }).expect(201);
    });

    it('refuses scheduling in the past and for rejected candidates', async () => {
      await post('/interviews', { application_id: appIds.strong, scheduled_at: inHours(-48) }).expect(400);
      await post('/interviews', { application_id: appIds.weak, scheduled_at: inHours(100) }).expect(409);
    });

    it('shows interviews on the calendar grouped by day', async () => {
      const res = await get(`/interviews/calendar?from=${inHours(0)}&to=${inHours(24 * 10)}`).expect(200);
      expect(res.body.data.total).toBe(3);
      const events = Object.values(res.body.data.days).flat();
      expect(events.map((e) => e.id)).toContain(interview.id);
      expect(events.find((e) => e.id === interview.id).candidate).toBe('Student strong');
    });

    it('lists with filters', async () => {
      const res = await get('/interviews?status=scheduled').expect(200);
      expect(res.body.meta.total).toBe(3);
      expect((await get('/interviews?status=cancelled').expect(200)).body.meta.total).toBe(0);
    });

    it('reschedules (counting it) and exports an .ics file', async () => {
      const res = await patch(`/interviews/${interview.id}`, { scheduled_at: inHours(50), reason: 'Panel unavailable' }).expect(200);
      expect(res.body.data.status).toBe('rescheduled');
      expect(res.body.data.reschedule_count).toBe(1);
      const ics = await get(`/interviews/${interview.id}/ics`).expect(200);
      expect(ics.headers['content-type']).toMatch(/text\/calendar/);
      expect(ics.text).toContain('BEGIN:VEVENT');
    });

    it('rejects feedback before the interview has happened, then accepts it once past', async () => {
      await post(`/interviews/${interview.id}/feedback`, { rating: 4, recommendation: 'hire' }).expect(409);
      // move the slot into the past directly to simulate time passing
      const ivRepo = require('../../repositories/hrInterview.repository');
      await ivRepo.updateById(interview.id, { scheduled_at: new Date(Date.now() - 3600000), end_at: new Date(Date.now() - 1800000) });
      const res = await post(`/interviews/${interview.id}/feedback`, { rating: 4, recommendation: 'hire', strengths: 'Clear thinker', skill_ratings: [{ skill: 'React', rating: 5 }] }).expect(200);
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.feedback_summary).toMatchObject({ count: 1, average_rating: 4 });
      // the same panelist submitting again replaces rather than duplicates
      const again = await post(`/interviews/${interview.id}/feedback`, { rating: 5, recommendation: 'strong_hire' }).expect(200);
      expect(again.body.data.feedback_summary).toMatchObject({ count: 1, average_rating: 5 });
    });

    it('cancels with a reason and does not allow editing a cancelled interview', async () => {
      const all = await get('/interviews?status=scheduled').expect(200);
      const target = all.body.data[0];
      await patch(`/interviews/${target.id}/status`, { status: 'cancelled', reason: 'Position on hold' }).expect(200);
      await patch(`/interviews/${target.id}`, { notes: 'x' }).expect(409);
    });

    it('keeps other recruiters out', async () => {
      await get(`/interviews/${interview.id}`, otherHrToken).expect(403);
      await patch(`/interviews/${interview.id}/status`, { status: 'no_show' }, otherHrToken).expect(403);
    });
  });

  describe('candidate evaluation', () => {
    it('saves a skill-wise scorecard and computes a weighted score', async () => {
      const res = await put(`/evaluations/application/${appIds.strong}`, {
        scores: [
          { name: 'React', category: 'technical', rating: 5, weight: 2 },
          { name: 'Communication', category: 'behavioral', rating: 3, weight: 1 },
        ],
        recommendation: 'hire', strengths: 'Strong frontend',
      }).expect(200);
      // (5*2 + 3*1) / 3 = 4.333 → 87%
      expect(res.body.data.score_percent).toBe(87);
      expect(res.body.data.application_overall_score).toBeGreaterThan(0);
    });

    it('replaces the same evaluator\'s scorecard instead of duplicating', async () => {
      await put(`/evaluations/application/${appIds.strong}`, { scores: [{ name: 'React', rating: 4 }], recommendation: 'hire' }).expect(200);
      const res = await get(`/evaluations/application/${appIds.strong}`).expect(200);
      expect(res.body.data.evaluations).toHaveLength(1);
      expect(res.body.data.summary).toMatchObject({ evaluator_count: 1, evaluation_score: 80, interview_score: 100 });
      expect(res.body.data.summary.skills[0]).toMatchObject({ name: 'React', average_rating: 4 });
    });

    it('validates ratings', async () => {
      await put(`/evaluations/application/${appIds.strong}`, { scores: [{ name: 'React', rating: 9 }], recommendation: 'hire' }).expect(400);
      await put(`/evaluations/application/${appIds.strong}`, { scores: [], recommendation: 'hire' }).expect(400);
      await put(`/evaluations/application/${appIds.strong}`, { scores: [{ name: 'React', rating: 4 }], recommendation: 'hire' }, otherHrToken).expect(403);
    });

    it('ranks candidates with explainable components', async () => {
      await put(`/evaluations/application/${appIds.extra}`, { scores: [{ name: 'React', rating: 2 }], recommendation: 'hold' }).expect(200);
      const res = await get(`/evaluations/vacancy/${placement.id}/ranking`).expect(200);
      const rows = res.body.data.rows;
      expect(rows.map((r) => r.rank)).toEqual([...rows.map((r) => r.rank)].sort((a, b) => a - b));
      expect(rows[0].application_id).toBe(appIds.strong); // interviewed + evaluated well beats a higher raw match
      expect(rows[0]).toMatchObject({ evaluation_score: 80, interview_score: 100 });
      expect(rows.some((r) => r.application_id === appIds.weak)).toBe(false); // rejected hidden by default
      const withRejected = await get(`/evaluations/vacancy/${placement.id}/ranking?include_rejected=true`).expect(200);
      expect(withRejected.body.data.rows.some((r) => r.application_id === appIds.weak)).toBe(true);
    });
  });

  describe('talent pool', () => {
    let entry;

    it('saves an applicant with category and tags, capturing skills', async () => {
      const res = await post('/talent-pool', { application_id: appIds.weak, category: 'Design', tags: ['photoshop', 'ui'], rating: 3, notes: 'Revisit for design roles' }).expect(201);
      entry = res.body.data;
      expect(entry.skills).toContain('Photoshop');
      expect(entry.source_placement_id).toBe(placement.id);
    });

    it('does not save the same candidate twice', async () => {
      await post('/talent-pool', { student_id: students.weak.student.id }).expect(409);
    });

    it('requires exactly one of student_id / application_id', async () => {
      await post('/talent-pool', { category: 'x' }).expect(400);
    });

    it('searches and filters the pool', async () => {
      await post('/talent-pool', { student_id: students.mid.student.id, category: 'Backend', tags: ['python'], rating: 4 }).expect(201);
      expect((await get('/talent-pool').expect(200)).body.meta.total).toBe(2);
      expect((await get('/talent-pool?category=Design').expect(200)).body.data.map((e) => e.id)).toEqual([entry.id]);
      expect((await get('/talent-pool?tag=PYTHON').expect(200)).body.meta.total).toBe(1);
      expect((await get('/talent-pool?skill=react').expect(200)).body.meta.total).toBe(1);
      expect((await get('/talent-pool?q=student weak').expect(200)).body.data[0].id).toBe(entry.id);
      expect((await get('/talent-pool?q=revisit').expect(200)).body.meta.total).toBe(1);
      expect((await get('/talent-pool?min_rating=4').expect(200)).body.meta.total).toBe(1);
      expect((await get('/talent-pool?min_cgpa=7.5').expect(200)).body.meta.total).toBe(1);
    });

    it('is invisible to other organisations', async () => {
      expect((await get('/talent-pool', otherHrToken).expect(200)).body.meta.total).toBe(0);
      await get(`/talent-pool/${entry.id}`, otherHrToken).expect(403);
      await patch(`/talent-pool/${entry.id}`, { rating: 1 }, otherHrToken).expect(403);
    });

    it('exposes facets', async () => {
      const res = await get('/talent-pool/facets').expect(200);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.categories.map((c) => c.name).sort()).toEqual(['Backend', 'Design']);
    });

    it('updates, then reuses a saved candidate on a new vacancy', async () => {
      await patch(`/talent-pool/${entry.id}`, { rating: 5, tags: ['photoshop', 'figma'] }).expect(200);
      const job2 = (await request(app).post('/api/v1/jobs').set(auth(hrToken)).send({ title: 'UI Designer', status: 'open', required_skills: 'Photoshop, Figma' }).expect(201)).body.data;
      const matches = await get(`/talent-pool/vacancy/${job2.id}/matches`).expect(200);
      expect(matches.body.data.candidates[0].entry_id).toBe(entry.id);

      const res = await post(`/talent-pool/${entry.id}/assign`, { placement_id: job2.id }).expect(200);
      expect(res.body.data.status).toBe('shortlisted');
      expect(res.body.data.source).toBe('talent_pool');
      const after = await get(`/talent-pool/${entry.id}`).expect(200);
      expect(after.body.data.used_in_placements).toEqual([job2.id]);
      expect(after.body.data.status).toBe('contacted');
      await post(`/talent-pool/${entry.id}/assign`, { placement_id: job2.id }).expect(200); // idempotent
    });

    it('removes entries', async () => {
      await request(app).delete(`/api/v1/hr/talent-pool/${entry.id}`).set(auth(hrToken)).expect(200);
      await get(`/talent-pool/${entry.id}`).expect(404);
    });

    it('searches platform students without leaking contact details', async () => {
      const res = await get('/talent-pool/search-students?q=Student stranger').expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].email).toBeUndefined();
    });
  });

  describe('hiring and employee management', () => {
    let employee;

    it('hiring a selected candidate opens an employee with an onboarding checklist', async () => {
      await patch(`/applications/${appIds.strong}/stage`, { status: 'selected' }).expect(200);
      const res = await patch(`/applications/${appIds.strong}/stage`, { status: 'hired', hire: { join_date: inHours(24 * 14), department: 'Engineering', manager_name: 'Meera' } }).expect(200);
      expect(res.body.data.hired_at).toBeTruthy();

      const list = await get('/employees').expect(200);
      expect(list.body.meta.total).toBe(1);
      employee = list.body.data[0];
      expect(employee).toMatchObject({ full_name: 'Student strong', employee_code: 'EMP-0001', status: 'onboarding', department: 'Engineering', designation: 'Full Stack Developer' });
      expect(employee.onboarding.tasks.length).toBeGreaterThan(5);
      expect(employee.onboarding.progress).toBe(0);
    });

    it('cannot move a hired application again', async () => {
      await patch(`/applications/${appIds.strong}/stage`, { status: 'rejected' }).expect(409);
    });

    it('does not duplicate the employee when converted again', async () => {
      await post(`/employees/from-application/${appIds.strong}`, {}).expect(201);
      expect((await get('/employees').expect(200)).body.meta.total).toBe(1);
    });

    it('completing the checklist activates the employee', async () => {
      const full = (await get(`/employees/${employee.id}`).expect(200)).body.data;
      let last;
      for (const t of full.onboarding.tasks) {
        last = await patch(`/employees/${employee.id}/onboarding/tasks/${t.id}`, { status: 'done' }).expect(200);
      }
      expect(last.body.data.onboarding.progress).toBe(100);
      expect(last.body.data.status).toBe('active');
      const added = await post(`/employees/${employee.id}/onboarding/tasks`, { title: 'Security training' }).expect(201);
      expect(added.body.data.onboarding.progress).toBeLessThan(100);
      expect(added.body.data.status).toBe('onboarding');
    });

    it('creates an employee manually and rejects duplicate emails', async () => {
      const res = await post('/employees', { full_name: 'Kiran Rao', email: 'Kiran@Acme.test', designation: 'Accountant', department: 'Finance', join_date: inHours(48) }).expect(201);
      expect(res.body.data.employee_code).toBe('EMP-0002');
      expect(res.body.data.email).toBe('kiran@acme.test');
      await post('/employees', { full_name: 'Kiran Again', email: 'kiran@acme.test' }).expect(409);
      expect((await get('/employees?q=kiran').expect(200)).body.meta.total).toBe(1);
      expect((await get('/employees?department=Finance').expect(200)).body.meta.total).toBe(1);
    });

    it('manages skills and certifications', async () => {
      await put(`/employees/${employee.id}/skills`, { name: 'Leadership', level: 'intermediate' }).expect(200);
      const s = await put(`/employees/${employee.id}/skills`, { name: 'leadership', level: 'advanced' }).expect(200);
      expect(s.body.data.skills.filter((x) => x.name.toLowerCase() === 'leadership')).toEqual([{ name: 'Leadership', level: 'advanced' }]);
      const c = await post(`/employees/${employee.id}/certifications`, { name: 'AWS Cloud Practitioner', issuer: 'AWS', issued_on: '2025-01-10', expires_on: '2028-01-10' }).expect(201);
      const certId = c.body.data.certifications[0].id;
      await request(app).delete(`/api/v1/hr/employees/${employee.id}/certifications/${certId}`).set(auth(hrToken)).expect(200);
      await request(app).delete(`/api/v1/hr/employees/${employee.id}/skills/Leadership`).set(auth(hrToken)).expect(200);
    });

    it('stores employee documents privately and serves them via signed URLs only', async () => {
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
      const up = await request(app).post(`/api/v1/hr/employees/${employee.id}/documents`).set(auth(hrToken))
        .field('type', 'id_proof').field('name', 'Aadhaar')
        .attach('file', pdf, { filename: 'id.pdf', contentType: 'application/pdf' }).expect(201);
      const doc = up.body.data.document;
      expect(doc).toMatchObject({ name: 'Aadhaar', type: 'id_proof', verified: false });

      const fake = await request(app).post(`/api/v1/hr/employees/${employee.id}/documents`).set(auth(hrToken))
        .attach('file', Buffer.from('not a pdf at all'), { filename: 'x.pdf', contentType: 'application/pdf' }).expect(400);
      expect(fake.body.message).toMatch(/valid PDF/);

      await request(app).get(doc.url).expect(403); // unsigned link refused
      const signed = await get(`/employees/${employee.id}/documents/${doc.id}/url`).expect(200);
      const file = await request(app).get(signed.body.data.url).expect(200);
      expect(file.headers['content-type']).toMatch(/pdf/);
      await get(`/employees/${employee.id}/documents/${doc.id}/url`, otherHrToken).expect(403);

      const verified = await patch(`/employees/${employee.id}/documents/${doc.id}`, { verified: true }).expect(200);
      expect(verified.body.data.documents[0].verified).toBe(true);
      await request(app).delete(`/api/v1/hr/employees/${employee.id}/documents/${doc.id}`).set(auth(hrToken)).expect(200);
    });

    it('tracks performance reviews, goals and trends', async () => {
      await post(`/employees/${employee.id}/performance/reviews`, { period: 'Q1 2026', rating: 3, goals: [{ title: 'Ship auth module' }] }).expect(201);
      const r2 = await post(`/employees/${employee.id}/performance/reviews`, { period: 'Q2 2026', rating: 4.5, review_date: inHours(24 * 90) }).expect(201);
      expect(r2.body.data.performance_reviews).toHaveLength(2);
      const rev = r2.body.data.performance_reviews[0];
      await patch(`/employees/${employee.id}/performance/reviews/${rev.id}/goals/${rev.goals[0].id}`, { status: 'done', progress: 100 }).expect(200);
      const perf = await get(`/employees/${employee.id}/performance`).expect(200);
      expect(perf.body.data).toMatchObject({ review_count: 2, average_rating: 3.8, latest_rating: 4.5, trend: 'improving' });
      expect(perf.body.data.goals).toMatchObject({ total: 1, completed: 1 });
    });

    it('keeps employees private to their organisation', async () => {
      await get(`/employees/${employee.id}`, otherHrToken).expect(403);
      await patch(`/employees/${employee.id}`, { status: 'exited' }, otherHrToken).expect(403);
      expect((await get('/employees', otherHrToken).expect(200)).body.meta.total).toBe(0);
    });

    it('exits an employee with an exit date', async () => {
      const res = await patch(`/employees/${employee.id}`, { status: 'exited' }).expect(200);
      expect(res.body.data.exit_date).toBeTruthy();
      expect((await get('/employees/stats').expect(200)).body.data.total_employees).toBe(1);
    });
  });

  describe('analytics and dashboard', () => {
    it('reports job analytics with definitions', async () => {
      const res = await get('/analytics').expect(200);
      const d = res.body.data;
      expect(d.definitions.interview_conversion_rate).toBeTruthy();
      expect(d.totals).toMatchObject({ applications: 5, hired: 1 });
      expect(d.totals.hiring_rate).toBeCloseTo((1 / 5) * 100, 0);
      expect(d.totals.time_to_hire_days.sample_size).toBe(1);
      const mine = d.by_vacancy.find((v) => v.placement_id === placement.id);
      expect(mine).toMatchObject({ applications: 4, shortlisted: 3, interviewed: 3, hired: 1, rejected: 1 });
      expect(mine.interview_conversion_rate).toBeCloseTo(33.3, 0); // 1 of 3 interviewed went on to selected/hired
      expect(d.funnel.map((f) => f.stage)).toEqual(['applied', 'screening', 'shortlisted', 'interview', 'selected', 'hired']);
      const sources = Object.fromEntries(d.sources.map((s) => [s.source, s.applications]));
      expect(sources).toMatchObject({ direct_application: 4, talent_pool: 1 });
      expect(d.rejection_reasons[0]).toMatchObject({ reason: 'Skills gap', count: 1 });
      expect(d.institutions[0]).toMatchObject({ applications: 5 });
    });

    it('scopes analytics to one vacancy and refuses someone else\'s', async () => {
      const res = await get(`/analytics?placement_id=${placement.id}`).expect(200);
      expect(res.body.data.totals.applications).toBe(4);
      await get(`/analytics?placement_id=${placement.id}`, otherHrToken).expect(403);
      expect((await get('/analytics', otherHrToken).expect(200)).body.data.totals.applications).toBe(0);
    });

    it('serves the HR dashboard figures', async () => {
      const res = await get('/dashboard').expect(200);
      const d = res.body.data;
      expect(d).toMatchObject({ total_employees: 1, open_positions: 2, total_applicants: 5, candidates_selected: 1 });
      expect(d.interviews_today).toEqual(expect.any(Number));
      expect(d.pending_hr_actions.total).toBeGreaterThan(0);
      expect(d.pending_hr_actions.items.map((i) => i.type)).toContain('onboarding');
      expect(d.pipeline).toMatchObject({ hired: 1, rejected: 1 });
      expect(Array.isArray(d.upcoming_interviews)).toBe(true);
    });

    it('counts today\'s interviews in the requested timezone', async () => {
      const soon = await post('/interviews', { application_id: appIds.mid, scheduled_at: inHours(0.5), force: true }).expect(201);
      const res = await get('/dashboard?tz_offset_minutes=0').expect(200);
      // today (UTC) holds an interview only if now+30min is still the same UTC day — avoid a flaky midnight edge
      const sameDay = new Date(soon.body.data.scheduled_at).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
      if (sameDay) expect(res.body.data.interviews_today).toBeGreaterThanOrEqual(1);
    });
  });
});
