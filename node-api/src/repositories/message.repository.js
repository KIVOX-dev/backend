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
