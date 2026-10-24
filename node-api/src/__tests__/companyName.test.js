const { normalizeCompanyName } = require('../utils/companyName');

describe('normalizeCompanyName', () => {
  it('stores every spelling of a listed company the same way', () => {
    expect(normalizeCompanyName('tcs')).toBe('TCS');
    expect(normalizeCompanyName(' Tcs ')).toBe('TCS');
    expect(normalizeCompanyName('hcl tech')).toBe('HCLTech');
  });

  it('title-cases unlisted lower-case names but keeps deliberate capitals', () => {
    expect(normalizeCompanyName('acme robotics')).toBe('Acme Robotics');
    expect(normalizeCompanyName('iGate')).toBe('iGate');
  });

  it('passes non-strings through unchanged', () => {
    expect(normalizeCompanyName(undefined)).toBeUndefined();
  });
});

const { normalizeRoleName } = require('../utils/roleName');

describe('normalizeRoleName', () => {
  it('stores short lower-case roles as acronyms and title-cases longer ones', () => {
    expect(normalizeRoleName('se')).toBe('SE');
    expect(normalizeRoleName(' sde ')).toBe('SDE');
    expect(normalizeRoleName('software engineer')).toBe('Software Engineer');
    expect(normalizeRoleName('se intern')).toBe('SE Intern');
    expect(normalizeRoleName('head of sales')).toBe('Head of Sales');
  });

  it('keeps deliberate capitals and passes non-strings through', () => {
    expect(normalizeRoleName('DevOps Engineer')).toBe('DevOps Engineer');
    expect(normalizeRoleName(undefined)).toBeUndefined();
  });
});
