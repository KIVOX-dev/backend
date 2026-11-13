const clock = require('../utils/examClock');

const MIN = 60 * 1000;
const T0 = new Date('2026-11-13T10:00:00Z').getTime();
const test30 = { duration_minutes: 30 };

function assignment(overrides = {}) {
  return { started_at: new Date(T0), last_heartbeat_at: new Date(T0), pauses: [], ...overrides };
}

describe('examClock', () => {
  it('deadline is start + duration, cutoff adds the 2 minute grace', () => {
    const a = assignment();
    expect(clock.deadlineMs(a, test30)).toBe(T0 + 30 * MIN);
    expect(clock.cutoffMs(a, test30)).toBe(T0 + 32 * MIN);
  });

  it('never extends past the test window end (plus grace)', () => {
    const windowed = { duration_minutes: 30, end_at: new Date(T0 + 10 * MIN) };
    expect(clock.cutoffMs(assignment(), windowed)).toBe(T0 + 12 * MIN);
  });

  it('credited pauses push the deadline out', () => {
    const a = assignment({ pauses: [{ credited_ms: 4 * MIN }] });
    expect(clock.deadlineMs(a, test30)).toBe(T0 + 34 * MIN);
    expect(clock.remainingSeconds(a, test30, T0 + 30 * MIN)).toBe(4 * 60);
  });

  it('ignores a "reconnected" claim when the server saw no real silence', () => {
    const now = T0 + 10 * 1000;
    expect(clock.buildPause(assignment(), now, { reported: true })).toBeNull();
  });

  it('ignores a silence the client never reported (no automatic credit, no accusation)', () => {
    expect(clock.buildPause(assignment(), T0 + 10 * MIN, { reported: false })).toBeNull();
  });

  it('records a reported gap using the SERVER last-contact time, not the claimed one', () => {
    const claimed = new Date(T0 - 60 * MIN).toISOString(); // absurd claim
    const pause = clock.buildPause(assignment(), T0 + 5 * MIN, { reported: true, claimedOfflineSince: claimed });
    expect(pause.from.getTime()).toBe(T0);
    expect(pause.credited_ms).toBe(5 * MIN);
    expect(pause.capped).toBe(false);
    expect(pause.claimed_offline_since.toISOString()).toBe(claimed);
  });

  it('caps total credited time but still records the full gap for review', () => {
    const a = assignment({ pauses: [{ credited_ms: 10 * MIN }] });
    const pause = clock.buildPause(a, T0 + 20 * MIN, { reported: true });
    expect(pause.gap_ms).toBe(20 * MIN);
    expect(pause.credited_ms).toBe(5 * MIN); // only 5 of the 15 minute allowance left
    expect(pause.capped).toBe(true);
  });
});
