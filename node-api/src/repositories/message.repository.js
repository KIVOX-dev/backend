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
}

module.exports = new MessageRepository();
