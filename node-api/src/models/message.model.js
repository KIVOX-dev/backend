// Ported from python-service's chat.py — 1:1 direct messages, persisted
// regardless of whether the receiver is currently connected (durable, so
// GET /chat/history/:otherUserId picks it up later either way).
//
// broadcast_id/broadcast_scope: an admin "broadcast" fans out into N
// individual 1:1 messages (one per real recipient) — there is no single
// conversation document for it, and no virtual recipient user to fetch
// history against. Every copy from the same send shares one broadcast_id
// (client-generated once per send, see PlatformChat.tsx#handleSend) so the
// sender's own view can reconstruct "my broadcast history" by grouping on
// it — see message.repository.js#findBroadcastHistory. Optional/absent on
// every ordinary 1:1 message.
module.exports = {
  tableName: 'messages',
  columns: ['sender_id', 'sender_name', 'sender_role', 'receiver_id', 'content', 'read', 'broadcast_id', 'broadcast_scope'],
  defaults: { read: false },
};
