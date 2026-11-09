const express = require('express');
const ServerDB = require('../db/ServerDB');
const jwt = require('jsonwebtoken');
const config = require('../config');

const router = express.Router();

// Auth Middleware
router.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Server name required' });
  
  const server = ServerDB.createServer(req.user.username, name);
  res.json(server);
});

router.get('/', (req, res) => {
  const servers = ServerDB.getUserServers(req.user.username);
  res.json(servers);
});

router.get('/:id/channels', (req, res) => {
  const channels = ServerDB.getServerChannels(req.params.id);
  res.json(channels);
});

module.exports = router;
