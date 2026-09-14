const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/message.model');

class MessageRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  // Both directions of a pair, chronological (oldest first) — matches
  // python-service's chat.py#get_chat_history (sorts desc for the query,
  // then reverses in-app for display order).
  async findConversation(userIdA, userIdB, limit = 50) {
    const docs = await this.collection
      .find({
        $or: [
          { sender_id: userIdA, receiver_id: userIdB },
          { sender_id: userIdB, receiver_id: userIdA },
        ],
      })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => this._toEntity(d)).reverse();
  }

  // The sender's own view of "my broadcast history" — one row per broadcast
  // SEND, not per fanned-out recipient copy (there could be dozens of those
  // for a single send). No conversation document backs a broadcast (there's
  // no single receiver_id to query by — see message.model.js's comment), so
  // this is the only way that history persists across sessions at all;
  // without it, GET /chat/history/-1 (the frontend's virtual broadcast
  // contact id) always legitimately returns nothing, and a broadcast the
  // admin just sent looks like it "vanishes" the moment local React state
  // resets (e.g. on logout/login), even though every real recipient's own
  // copy is durably stored and correct.
  async findBroadcastHistory(senderId, scope, limit = 50) {
    const docs = await this.collection
      .aggregate([
        { $match: { sender_id: senderId, broadcast_scope: scope, broadcast_id: { $exists: true, $ne: null } } },
        { $sort: { created_at: -1 } },
        { $group: { _id: '$broadcast_id', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { created_at: -1 } },
        { $limit: limit },
      ])
      .toArray();
    return docs.map((d) => this._toEntity(d)).reverse();
  }

  // Every distinct user this person has exchanged at least one message with,
  // in either direction — this is what lets a message actually SHOW UP for
  // its recipient. Without it, the frontend's contact list is built purely
  // from a role directory (GET /students, GET /users/), which never includes
  // whoever actually messaged you (e.g. an institution admin broadcasting to
  // students, who never appears in a student's own /students-scoped
  // directory) — the message is correctly persisted and delivered over the
  // socket, but there's nowhere in the UI it can appear until the sender is
  // a selectable contact. See chat.service.js#getThreads, the caller.
  async findPartnerIds(userId) {
    const rows = await this.collection
      .aggregate([
        { $match: { $or: [{ sender_id: userId }, { receiver_id: userId }] } },
        {
          $project: {
            partnerId: { $cond: [{ $eq: ['$sender_id', userId] }, '$receiver_id', '$sender_id'] },
          },
        },
        { $group: { _id: '$partnerId' } },
      ])
      .toArray();
    return rows.map((r) => r._id).filter(Boolean);
  }
}

module.exports = new MessageRepository();
