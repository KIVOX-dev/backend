// Direct-to-repository seeding for integration tests — bypasses the HTTP
// register flow (which forces new institution_admin/hr accounts to
// `pending`, see auth.service.js#SELF_REGISTERABLE_ROLES) so tests can spin
// up an already-approved staff account without an extra super_admin step.
async function seedInstitution(institutionRepository, overrides = {}) {
  return institutionRepository.create({
    name: 'Test Institute',
    code: `TI-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    is_active: true,
    ...overrides,
  });
}

async function seedUser(userRepository, hashPassword, { role, institutionId, email, password = 'Sup3rSecret!', ...rest }) {
  const password_hash = await hashPassword(password);
  const user = await userRepository.create({
    email,
    password_hash,
    full_name: rest.full_name || 'Test User',
    role,
    institution_id: institutionId || null,
    status: 'approved',
    is_active: true,
    token_version: 0,
    ...rest,
  });
  return { user, password };
}

module.exports = { seedInstitution, seedUser };
