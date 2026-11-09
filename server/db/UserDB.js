const db = require('./index');
const bcrypt = require('bcrypt');

class UserDB {
  static async register(username, password) {
    const userKey = `user:${username}`;
    if (db.get(userKey)) {
      throw new Error('Username already exists');
    }
    const hash = await bcrypt.hash(password, 10);
    const user = { username, passwordHash: hash, createdAt: Date.now() };
    db.set(userKey, user);
    return { username };
  }

  static async login(username, password) {
    const userKey = `user:${username}`;
    const user = db.get(userKey);
    if (!user) {
      throw new Error('User not found');
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new Error('Invalid password');
    }
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }
}

module.exports = UserDB;
