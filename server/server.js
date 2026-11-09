const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Setup Sockets
const socketHandler = require('./sockets/index');
socketHandler(io);

// Middleware
app.use(cors({
  origin: '*'
}));
app.use(express.static(path.join(__dirname, '..', 'public'))); // Serve the frontend
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// Routes
const authRoutes = require('./routes/auth');
const serverRoutes = require('./routes/servers');

app.use('/api/auth', authRoutes);
app.use('/api/servers', serverRoutes);

// Basic Route for testing
app.get('/api/health', (req, res) => {
  res.json({ message: 'Acero API is running' });
});

const port = config.port;
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
