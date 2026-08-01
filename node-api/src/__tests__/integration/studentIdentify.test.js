const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression test for a real bug found while auditing MongoDB indexes:
// student.service.js#identify (the unauthenticated kiosk check-in lookup)
// used to resolve the institution by name, then look up a student by
// roll_number ALONE — with no institution scoping — only rejecting a
// mismatch after the fact. Roll numbers are only unique *within* an
// institution (see the {institution_id, roll_number} unique index), so two
// colleges sharing a roll number could return the wrong student, and
// whichever one Mongo happened to return first could incorrectly fail a
// legitimate check-in. Fixed by scoping the lookup itself to
// {institution_id, roll_number} via findByInstitutionAndRollNumber.
describe('POST /students/identify: roll-number lookup is institution-scoped', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let studentRepository;
  let hashPassword;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, studentRepository, hashPassword } = await buildTestApp());
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  async function seedStudentWithRollNumber(institutionId, rollNumber, fullName) {
    const { user } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId,
      email: `identify-${Date.now()}-${Math.random()}@example.com`,
      full_name: fullName,
    });
    await studentRepository.create({
      user_id: user.id,
      institution_id: institutionId,
      roll_number: rollNumber,
      phone: '555-0100',
      date_of_birth: '2000-01-01',
      gender: 'female',
      address: '123 Test St',
      cgpa: 8.5,
    });
    return user;
  }

  it('returns the correct student when two institutions share the same roll number', async () => {
    const suffix = Date.now();
    const institutionA = await seedInstitution(institutionRepository, {
      name: `Alpha Institute of Technology ${suffix}`,
      code: `SIA-${suffix}`,
    });
    const institutionB = await seedInstitution(institutionRepository, {
      name: `Beta College of Engineering ${suffix}`,
      code: `SIB-${suffix}`,
    });

    await seedStudentWithRollNumber(institutionA.id, 'CS101', 'Student From Alpha');
    await seedStudentWithRollNumber(institutionB.id, 'CS101', 'Student From Beta');

    const res = await request(app)
      .post('/api/v1/students/identify')
      .send({ collegeName: `Beta College of Engineering ${suffix}`, rollNo: 'CS101' })
      .expect(200);

    expect(res.body.data.name).toBe('Student From Beta');
    expect(res.body.data.college).toBe(`Beta College of Engineering ${suffix}`);
  });

  it('returns 404 when the roll number exists only at a different institution', async () => {
    const suffix = Date.now();
    const institutionA = await seedInstitution(institutionRepository, {
      name: `Gamma University ${suffix}`,
      code: `SIC-${suffix}`,
    });
    // Seeded so its own existence (an unrelated institution) can't
    // accidentally make the lookup succeed — never referenced by name.
    await seedInstitution(institutionRepository, {
      name: `Delta Polytechnic ${suffix}`,
      code: `SID-${suffix}`,
    });

    await seedStudentWithRollNumber(institutionA.id, 'EE202', 'Only At Gamma');

    await request(app)
      .post('/api/v1/students/identify')
      .send({ collegeName: `Delta Polytechnic ${suffix}`, rollNo: 'EE202' })
      .expect(404);
  });
});
