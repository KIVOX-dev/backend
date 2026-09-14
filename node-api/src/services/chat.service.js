const messageRepository = require('../repositories/message.repository');
const userRepository = require('../repositories/user.repository');

class ChatService {
  async getHistory(userId, otherUserId, limit = 50) {
    const messages = await messageRepository.findConversation(userId, otherUserId, limit);
    return { messages };
  }

  // Contacts this user has an actual conversation with, regardless of role
  // directory scoping — see message.repository.js#findPartnerIds for why
  // this exists at all.
  async getThreads(userId) {
    const partnerIds = await messageRepository.findPartnerIds(userId);
    const partners = await userRepository.findByIds(partnerIds);
    return { partners };
  }
}

module.exports = new ChatService();
