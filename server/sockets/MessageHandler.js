const MessageDB = require('../db/MessageDB');

module.exports = function(io, socket) {
  // Join a channel to receive messages
  socket.on('joinChannel', (channelId) => {
    socket.join(channelId);
    console.log(`User ${socket.user.username} joined channel ${channelId}`);
    
    // Send previous messages to the user
    const messages = MessageDB.getMessages(channelId);
    socket.emit('channelHistory', { channelId, messages });
  });

  socket.on('sendMessage', (data) => {
    const { channelId, content } = data;
    if (!channelId || !content) return;

    const newMsg = MessageDB.addMessage(channelId, socket.user.username, content);
    
    // Broadcast to room
    io.to(channelId).emit('newMessage', newMsg);
  });
};
