import 'reflect-metadata';
import { Logger, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

const logger = new Logger('Worker');
let app: INestApplicationContext | undefined;
let terminalFailure = false;

try {
  app = await NestFactory.createApplicationContext(
    WorkerModule.register({
      fatal: async () => {
        process.exitCode = 1;
        terminalFailure = true;
        if (app) await app.close();
      },
    }),
    { abortOnError: false },
  );

  if (terminalFailure) {
    await app.close();
  } else {
    app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  }
} catch (error) {
  logger.error(error);
  process.exitCode = 1;
  if (app) await app.close();
}
