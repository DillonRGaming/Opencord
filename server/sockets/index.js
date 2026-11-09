const jwt = require('jsonwebtoken');
const config = require('../config');
const MessageHandler = require('./MessageHandler');

module.exports = function(io) {
  // Authentication middleware for sockets
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    
    jwt.verify(token, config.jwtSecret, (err, decoded) => {
      if (err) return next(new Error('Authentication error'));
      socket.user = decoded;
      next();
    });
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (User: ${socket.user.username})`);
    
    MessageHandler(io, socket);

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
};
