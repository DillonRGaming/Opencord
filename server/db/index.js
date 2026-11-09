const GraniteDB = require('./granitedb');
const path = require('path');
const dbPath = path.join(__dirname, 'acero.gdb');

// Setup central GraniteDB instance
const db = new GraniteDB(dbPath);

module.exports = db;
