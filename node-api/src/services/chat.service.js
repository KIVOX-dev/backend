const messageRepository = require('../repositories/message.repository');

class ChatService {
  async getHistory(userId, otherUserId, limit = 50) {
    const messages = await messageRepository.findConversation(userId, otherUserId, limit);
    return { messages };
  }
}

module.exports = new ChatService();
