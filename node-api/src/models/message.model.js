// Ported from python-service's chat.py — 1:1 direct messages, persisted
// regardless of whether the receiver is currently connected (durable, so
// GET /chat/history/:otherUserId picks it up later either way).
module.exports = {
  tableName: 'messages',
  columns: ['sender_id', 'sender_name', 'sender_role', 'receiver_id', 'content', 'read'],
  defaults: { read: false },
};
