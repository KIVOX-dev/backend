// One spelling per job role, so "se", "SE " and "Se" are stored the same way.
// A short all-lower-case name is an acronym (se, sde, qa → SE, SDE, QA); a
// longer lower-case name is title-cased with two-letter words kept as
// acronyms; a name with deliberate capitals ("DevOps Engineer") is kept as
// typed. Keep in step with displayRoleName in the frontend's src/lib/roleName.ts.
const SMALL_WORDS = new Set(['of', 'to', 'in', 'at', 'an', 'or', 'as', 'by', 'on', 'for', 'and', 'the']);

function normalizeRoleName(role) {
  if (typeof role !== 'string') return role;
  const clean = role.trim().replace(/\s+/g, ' ');
  if (!clean) return clean;
  if (clean !== clean.toLowerCase()) return clean;
  if (!clean.includes(' ') && clean.length <= 3) return clean.toUpperCase();
  return clean
    .split(' ')
    .map((w, i) => {
      if (i > 0 && SMALL_WORDS.has(w)) return w;
      return w.length === 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

module.exports = { normalizeRoleName };
