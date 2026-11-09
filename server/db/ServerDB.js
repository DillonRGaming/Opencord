const db = require('./index');

class ServerDB {
  static createServer(ownerId, name) {
    const serverId = `srv_${Date.now()}`;
    const defaultChannelId = `chan_${Date.now()}`;
    const server = { id: serverId, ownerId, name, defaultChannelId };
    db.set(`server:${serverId}`, server);
    
    // Create the default channel
    const channel = { id: defaultChannelId, serverId, name: 'general' };
    db.set(`channel:${defaultChannelId}`, channel);

    // Index server channels
    const channelsIndexKey = `idx:server-channels:${serverId}`;
    db.set(channelsIndexKey, [defaultChannelId]);

    // Index user servers
    const userIndexKey = `idx:user-servers:${ownerId}`;
    const serverIds = db.get(userIndexKey) || [];
    serverIds.push(serverId);
    db.set(userIndexKey, serverIds);
    
    return server;
  }

  static getUserServers(userId) {
    const indexKey = `idx:user-servers:${userId}`;
    const serverIds = db.get(indexKey) || [];
    return serverIds.map(id => db.get(`server:${id}`)).filter(Boolean);
  }

  static getServerChannels(serverId) {
    const indexKey = `idx:server-channels:${serverId}`;
    const channelIds = db.get(indexKey) || [];
    return channelIds.map(id => db.get(`channel:${id}`)).filter(Boolean);
  }
}

module.exports = ServerDB;
