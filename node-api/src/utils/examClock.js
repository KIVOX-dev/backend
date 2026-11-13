// Server-side exam clock. The server — never the browser — decides when a
// student's time is up (answered Q4: server clock + short grace period), and
// pauses the clock only for *detected* connection loss (Q5), recording every
// pause so an admin can review it. A pause is evidence for a human to look at,
// never an accusation: nothing here flags malpractice or alters a result.

const GRACE_MS = 2 * 60 * 1000;
// A client that's online pings (autosave / heartbeat) every ~15s. A silence
// shorter than this is ordinary jitter, not a connection loss worth pausing.
const STALE_HEARTBEAT_MS = 45 * 1000;
// Total pause the server will credit per attempt. Beyond this the pause is
// still recorded (and marked `capped`) for admin review, but no extra time is
// granted — a client claiming "I was offline" can't buy unlimited time.
const MAX_PAUSE_TOTAL_MS = 15 * 60 * 1000;

function creditedPauseMs(pauses = []) {
  return pauses.reduce((sum, p) => sum + (p.credited_ms || 0), 0);
}

// Moment the student's own time runs out (excluding grace).
function deadlineMs(assignment, test) {
  const startedAt = new Date(assignment.started_at).getTime();
  return startedAt + (test?.duration_minutes || 0) * 60 * 1000 + creditedPauseMs(assignment.pauses);
}

// Last moment a submission is still accepted: the student's own deadline plus
// grace, and — if the test has a window — the window's end plus grace.
function cutoffMs(assignment, test) {
  let cutoff = deadlineMs(assignment, test) + GRACE_MS;
  if (test?.end_at) cutoff = Math.min(cutoff, new Date(test.end_at).getTime() + GRACE_MS);
  return cutoff;
}

function remainingSeconds(assignment, test, now = Date.now()) {
  return Math.max(0, Math.floor((deadlineMs(assignment, test) - now) / 1000));
}

// Decide whether the silence since the last server-verified contact counts as
// a connection-loss pause. `reported` = the client says it just reconnected.
// The pause START is always the server's own last-contact time — the client's
// claimed offline time is stored for review but never trusted for timing.
// Returns the pause record to append, or null when there's nothing to record.
function buildPause(assignment, now, { reported, claimedOfflineSince } = {}) {
  if (!reported || !assignment.started_at) return null;
  const lastContact = new Date(assignment.last_heartbeat_at || assignment.started_at).getTime();
  const gap = now - lastContact;
  if (gap < STALE_HEARTBEAT_MS) return null;

  const alreadyCredited = creditedPauseMs(assignment.pauses);
  const room = Math.max(0, MAX_PAUSE_TOTAL_MS - alreadyCredited);
  const credited = Math.min(gap, room);
  return {
    from: new Date(lastContact),
    to: new Date(now),
    gap_ms: gap,
    credited_ms: credited,
    capped: credited < gap,
    reason: 'connection_lost',
    claimed_offline_since: claimedOfflineSince ? new Date(claimedOfflineSince) : null,
  };
}

module.exports = {
  GRACE_MS, STALE_HEARTBEAT_MS, MAX_PAUSE_TOTAL_MS,
  creditedPauseMs, deadlineMs, cutoffMs, remainingSeconds, buildPause,
};
