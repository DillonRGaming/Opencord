const express = require('express');
const jwt = require('jsonwebtoken');
const UserDB = require('../db/UserDB');
const config = require('../config');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    
    const user = await UserDB.register(username, password);
    const token = jwt.sign({ username: user.username }, config.jwtSecret);
    res.json({ token, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await UserDB.login(username, password);
    const token = jwt.sign({ username: user.username }, config.jwtSecret);
    res.json({ token, user });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

module.exports = router;
