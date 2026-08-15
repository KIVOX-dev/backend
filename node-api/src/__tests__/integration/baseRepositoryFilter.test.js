const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution } = require('../helpers/seed');

// Regression test: BaseRepository._buildFilter used to silently drop an
// invalid/empty `id` filter instead of failing closed, which turned
// `findAll({ filters: { id: '' } })` into an unfiltered listing instead of
// an empty result set (see repositories/BaseRepository.js).
describe('BaseRepository: invalid id filters fail closed', () => {
  let database;
  let institutionRepository;

  beforeAll(async () => {
    ({ database, institutionRepository } = await buildTestApp());
    await seedInstitution(institutionRepository, { name: 'Filter Test Institute', code: `INST-FILTER-${Date.now()}` });
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  it('returns no rows for an empty-string id filter instead of the full list', async () => {
    const { rows, total } = await institutionRepository.findAll({ filters: { id: '' } });
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it('returns no rows for a non-string id filter instead of the full list', async () => {
    const { rows, total } = await institutionRepository.findAll({ filters: { id: 12345 } });
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it('findOne returns null for an empty-string id filter', async () => {
    const result = await institutionRepository.findOne({ id: '' });
    expect(result).toBeNull();
  });
});
