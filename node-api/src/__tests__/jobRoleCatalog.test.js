const { listRoles, getRole } = require('../config/jobRoleCatalog');
const { SKILLS, matchSkill } = require('../config/skillCatalog');

// A role's skills are what a lesson imported off its roadmap earns badges for,
// so each one has to be a real entry in the skill catalog — a typo here would
// leave a roadmap step no lesson can ever complete.
describe('job role catalog', () => {
  const skillNames = new Set(SKILLS.map((s) => s.name));

  it('only references skills that exist in the skill catalog', () => {
    const missing = [];
    for (const role of listRoles()) {
      for (const skill of role.skills) if (!skillNames.has(skill)) missing.push(`${role.id}: ${skill}`);
    }
    expect(missing).toEqual([]);
  });

  it('has unique role ids, unique skill names, and no empty or repeated role skills', () => {
    const ids = listRoles().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(skillNames.size).toBe(SKILLS.length);
    for (const role of listRoles()) {
      expect(role.title).toBeTruthy();
      expect(role.description).toBeTruthy();
      expect(role.skills.length).toBeGreaterThan(0);
      expect(new Set(role.skills).size).toBe(role.skills.length);
      expect(getRole(role.id)).toBe(role);
    }
  });

  it('tags lessons with the most specific skill that matches', () => {
    expect(matchSkill('Generative AI with Python')).toBe('Generative AI');
    expect(matchSkill('Spring Boot Full Course')).toBe('Spring Boot');
    expect(matchSkill('Data Structures and Algorithms in C++')).toBe('Data Structures & Algorithms');
    // The long-standing matches are unchanged.
    expect(matchSkill('Node.js crash course')).toBe('Node.js');
    expect(matchSkill('React JS tutorial')).toBe('React');
    expect(matchSkill('Python for everybody')).toBe('Python');
  });
});
