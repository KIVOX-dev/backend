const messageRepository = require('../repositories/message.repository');
const userRepository = require('../repositories/user.repository');
const { ROLES } = require('../config/constants');

class ChatService {
  async getHistory(userId, otherUserId, limit = 50) {
    const messages = await messageRepository.findConversation(userId, otherUserId, limit);
    return { messages };
  }

  async getBroadcastHistory(userId, scope, limit = 50) {
    const messages = await messageRepository.findBroadcastHistory(userId, scope, limit);
    return { messages };
  }

  // Contacts this user has an actual conversation with, regardless of role
  // directory scoping — see message.repository.js#findPartnerIds for why
  // this exists at all.
  // Everyone in the caller's own institution they're allowed to message —
  // students, faculty and institution admins. Ids are *user* ids, which is
  // what the chat socket addresses messages by (chatServer.js looks the
  // receiver up with userRepository.findById and silently drops the message
  // if there's no such user). The old non-admin directory came from
  // GET /students, whose ids are student-record ids, so a message sent to
  // one of those contacts never reached anyone.
  async getContacts(actor) {
    if (!actor.institutionId) return [];
    const docs = await userRepository.collection
      .find(
        {
          institution_id: actor.institutionId,
          role: { $in: [ROLES.STUDENT, ROLES.FACULTY, ROLES.INSTITUTION_ADMIN] },
          is_active: { $ne: false },
          _id: { $ne: actor.id },
        },
        { projection: { full_name: 1, email: 1, role: 1, avatar_url: 1 } }
      )
      .sort({ full_name: 1 })
      .limit(1000)
      .toArray();
    return docs.map(({ _id, ...rest }) => ({ id: _id, ...rest }));
  }

  async getThreads(userId) {
    const partnerIds = await messageRepository.findPartnerIds(userId);
    const partners = await userRepository.findByIds(partnerIds);
    return { partners };
  }
}

module.exports = new ChatService();
