const { randomUUID } = require('node:crypto');
const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/emailNotification.model');

// A `sending` row older than this is treated as abandoned by a crashed worker.
const STALE_LOCK_MS = 10 * 60 * 1000;

// A "scope" is one batch of emails: { entityType, entityId, eventType, roundNumber }.
// roundNumber is null for events that have none.
function scopeFilter(scope) {
  return {
    entity_type: scope.entityType,
    entity_id: scope.entityId,
    event_type: scope.eventType,
    round_number: scope.roundNumber ?? null,
  };
}

// Optional narrowing for admin queries: only the keys actually supplied apply.
function entityFilter(entityType, entityId, { eventType, roundNumber } = {}) {
  const filter = { entity_type: entityType, entity_id: entityId };
  if (eventType) filter.event_type = eventType;
  if (roundNumber !== undefined && roundNumber !== null) filter.round_number = roundNumber;
  return filter;
}

class EmailNotificationRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  // Inserts a `queued` row per student, skipping any that already have one
  // (any status). Returns the student ids that were actually newly inserted —
  // that is the idempotency check: a student with an existing row is never
  // re-queued here, only via resetFailed().
  // `extra` is merged into every newly inserted row (e.g. uses_default_password).
  async insertQueued(scope, institutionId, studentIds, extra = {}) {
    const unique = [...new Set(studentIds)].filter(Boolean);
    if (unique.length === 0) return [];
    const now = new Date();
    const base = scopeFilter(scope);
    const result = await this.collection.bulkWrite(
      unique.map((studentId) => ({
        updateOne: {
          filter: { ...base, student_id: studentId },
          update: {
            $setOnInsert: {
              _id: randomUUID(),
              ...defaults,
              ...extra,
              ...base,
              student_id: studentId,
              institution_id: institutionId,
              created_at: now,
              updated_at: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    return Object.keys(result.upsertedIds).map((i) => unique[Number(i)]);
  }

  // Atomically claims up to `limit` sendable rows for this scope. Per-row
  // findOneAndUpdate (not find-then-updateMany) so two workers can never
  // claim the same row.
  async claimBatch(scope, limit) {
    const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
    const base = scopeFilter(scope);
    const claimed = [];
    while (claimed.length < limit) {
      const now = new Date();
      const doc = await this.collection.findOneAndUpdate(
        { ...base, $or: [{ status: 'queued' }, { status: 'sending', locked_at: { $lt: staleBefore } }] },
        { $set: { status: 'sending', locked_at: now, updated_at: now }, $inc: { attempts: 1 } },
        { returnDocument: 'after' }
      );
      if (!doc) break;
      claimed.push(this._toEntity(doc));
    }
    return claimed;
  }

  markSent(id, { email, messageId }) {
    const now = new Date();
    return this.collection.updateOne(
      { _id: id },
      {
        $set: {
          status: 'sent', email, brevo_message_id: messageId || null,
          error_message: null, sent_at: now, locked_at: null, updated_at: now,
        },
      }
    );
  }

  markFailed(id, { email, error }) {
    const set = { status: 'failed', error_message: String(error).slice(0, 500), locked_at: null, updated_at: new Date() };
    if (email) set.email = email;
    return this.collection.updateOne({ _id: id }, { $set: set });
  }

  // Failed rows go back to `queued` for a resend. Only `failed` rows —
  // `sent` rows are never touched, so a resend can't duplicate an email.
  // Returns the scopes that had failures so the caller can re-enqueue each.
  async resetFailed(entityType, entityId, filters) {
    const filter = { ...entityFilter(entityType, entityId, filters), status: 'failed' };
    const groups = await this.collection
      .aggregate([{ $match: filter }, { $group: { _id: { event_type: '$event_type', round_number: '$round_number' } } }])
      .toArray();
    if (groups.length === 0) return { requeued: 0, scopes: [] };
    const { modifiedCount } = await this.collection.updateMany(filter, {
      $set: { status: 'queued', attempts: 0, error_message: null, updated_at: new Date() },
    });
    const scopes = groups.map((g) => ({
      entityType, entityId, eventType: g._id.event_type, roundNumber: g._id.round_number ?? null,
    }));
    return { requeued: modifiedCount, scopes };
  }

  async summarize(entityType, entityId, filters) {
    const rows = await this.collection
      .aggregate([{ $match: entityFilter(entityType, entityId, filters) }, { $group: { _id: '$status', count: { $sum: 1 } } }])
      .toArray();
    const by = Object.fromEntries(rows.map((r) => [r._id, r.count]));
    const pending = (by.queued || 0) + (by.sending || 0);
    return {
      sent: by.sent || 0,
      failed: by.failed || 0,
      pending,
      total: (by.sent || 0) + (by.failed || 0) + pending,
    };
  }

  async listFailed(entityType, entityId, filters, limit = 100) {
    const docs = await this.collection
      .find({ ...entityFilter(entityType, entityId, filters), status: 'failed' })
      .sort({ updated_at: -1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => this._toEntity(d));
  }

  // Scopes that still have sendable rows — used on worker start to re-enqueue
  // work whose queue job was lost (Redis outage, crash between insert and enqueue).
  async pendingScopes() {
    const groups = await this.collection
      .aggregate([
        { $match: { status: { $in: ['queued', 'sending'] } } },
        { $group: { _id: { entity_type: '$entity_type', entity_id: '$entity_id', event_type: '$event_type', round_number: '$round_number' } } },
      ])
      .toArray();
    return groups.map((g) => ({
      entityType: g._id.entity_type, entityId: g._id.entity_id, eventType: g._id.event_type, roundNumber: g._id.round_number ?? null,
    }));
  }
}

module.exports = new EmailNotificationRepository();
