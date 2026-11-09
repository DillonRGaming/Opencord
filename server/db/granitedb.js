const fs = require('fs');
const crypto = require('crypto');

class GraniteDB {
    constructor(dbName = 'database.gdb') {
        this.dbName = dbName;
        this.memoryState = {};
        
        // Open a non-blocking append stream for ultimate write speed
        this.dbStream = fs.createWriteStream(this.dbName, { flags: 'a' });
        this._loadDB();
        
        console.log(`[GraniteDB] Engine Online. Tracking file: ${this.dbName}`);
    }

    _loadDB() {
        if (!fs.existsSync(this.dbName)) return;
        
        const lines = fs.readFileSync(this.dbName, 'utf-8').split('\n');
        let count = 0;
        
        lines.forEach(line => {
            if (!line) return;
            const record = JSON.parse(line);
            if (record.action === 'SET') {
                this.memoryState[record.key] = record.value;
                count++;
            }
            if (record.action === 'DELETE') {
                delete this.memoryState[record.key];
                count--;
            }
        });
        console.log(`[GraniteDB] Loaded ${count} records into memory.`);
    }

    _write(action, key, value = null) {
        const entry = JSON.stringify({ t: Date.now(), a: action, k: key, v: value }) + '\n';
        this.dbStream.write(entry);
    }

    // --- CORE API ---
    
    set(key, value) {
        this.memoryState[key] = value;
        this._write('SET', key, value);
        return true;
    }

    get(key) {
        return this.memoryState[key] || null;
    }

    delete(key) {
        delete this.memoryState[key];
        this._write('DELETE', key);
        return true;
    }

    getPrefix(prefix) {
        return Object.keys(this.memoryState)
            .filter(key => key.startsWith(prefix))
            .sort() // Sorts chronologically if keys are time-based
            .map(key => this.memoryState[key]);
    }

    // --- BUILT-IN AUTHENTICATION ---
    register(username, password) {
        const userKey = `user:${username}`;
        
        if (this.memoryState[userKey]) {
            return { success: false, error: 'Username already exists.' };
        }

        const hash = crypto.createHash('sha256').update(password).digest('hex');
        const userData = { username, passwordHash: hash, createdAt: Date.now() };
        
        this.set(userKey, userData);
        return { success: true, data: { username } };
    }

    login(username, password) {
        const user = this.memoryState[`user:${username}`];
        if (!user) return { success: false, error: 'User not found.' };

        const hash = crypto.createHash('sha256').update(password).digest('hex');
        if (user.passwordHash !== hash) return { success: false, error: 'Invalid password.' };

        // Strip the hash before returning the user object
        const { passwordHash, ...safeUser } = user;
        return { success: true, data: safeUser };
    }
}

module.exports = GraniteDB;
