// Guards against Mongo $regex injection (a search string containing regex
// metacharacters silently changing what the query matches, e.g. `.*` to
// match everything, or `(a+)+$`-style patterns built from attacker input to
// cause catastrophic backtracking / ReDoS) anywhere a user-supplied string
// is interpolated into a $regex filter. Every caller should also cap input
// length before this — a bounded literal string cannot backtrack
// catastrophically no matter how it's escaped, so length is the real ReDoS
// defense and escaping is the injection defense.
const METACHARACTERS = /[.*+?^${}()|[\]\\]/g;
const MAX_SEARCH_LENGTH = 200;

function escapeRegex(input) {
  if (typeof input !== 'string') return '';
  return input.slice(0, MAX_SEARCH_LENGTH).replace(METACHARACTERS, '\\$&');
}

module.exports = { escapeRegex, MAX_SEARCH_LENGTH };
