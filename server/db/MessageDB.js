const db = require('./index');

class MessageDB {
  static addMessage(channelId, user, content) {
    const msgId = `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newMsg = { id: msgId, channelId, user, content, createdAt: Date.now() };
    db.set(`msg:${msgId}`, newMsg);

    // Indexing message ID per channel to avoid Object.keys scans
    const indexKey = `idx:channel-messages:${channelId}`;
    const messageIds = db.get(indexKey) || [];
    messageIds.push(msgId);
    
    // Cap at latest 50 for memory safety locally (optional feature)
    if (messageIds.length > 50) messageIds.shift();

    db.set(indexKey, messageIds);

    return newMsg;
  }

  static getMessages(channelId) {
    const indexKey = `idx:channel-messages:${channelId}`;
    const messageIds = db.get(indexKey) || [];
    return messageIds.map(id => db.get(`msg:${id}`)).filter(Boolean);
  }
}

module.exports = MessageDB;
