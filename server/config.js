const config = {
  apiBaseUrl: 'http://localhost:3001',
  port: process.env.PORT || 3001,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret' // set JWT_SECRET when running for real
};

module.exports = config;
