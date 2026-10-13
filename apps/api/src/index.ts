import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createPool, repository } from '@nexus/database';
import { buildApp } from './app.js';

const logger = new Logger('Api');
const databaseUrl = process.env.DATABASE_URL;
const token = process.env.API_TOKEN;
if (!databaseUrl || !token) throw new Error('DATABASE_URL and API_TOKEN are required');
const port = Number(process.env.API_PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT');
const pool = createPool(databaseUrl);
pool.on('error', error => logger.error(error, 'Idle database connection failed'));
const app = await buildApp(repository(pool), token, { logger: true, closeDatabase: async () => { await pool.end(); } });
app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
try {
  await app.listen(port, process.env.API_HOST ?? '127.0.0.1');
  const server = app.getHttpServer();
  server.requestTimeout = 15000;
  logger.log('API listening on ' + await app.getUrl());
} catch (error) { logger.error(error); await app.close(); process.exitCode = 1; }

