'use strict';

const app = require('./src/app');
const config = require('./src/config');

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[sport-meal] local:  http://127.0.0.1:${config.port}`);
  console.log(`[sport-meal] LAN:    http://<本机局域网IP>:${config.port}`);
  console.log(`[sport-meal] health: http://127.0.0.1:${config.port}/api/health`);
});

function shutdown(signal) {
  console.log(`[sport-meal] ${signal}, shutting down...`);
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
