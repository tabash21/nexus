import 'reflect-metadata';
import { Logger, Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createResources, WorkerService, WORKER_FATAL, WORKER_RESOURCES } from './worker.service.js';

@Module({})
class WorkerModule {}
const logger = new Logger('Worker');
let app: INestApplicationContext | undefined;
let terminalFailure = false;
try {
  app = await NestFactory.createApplicationContext({
    module: WorkerModule,
    providers: [
      WorkerService,
      { provide: WORKER_RESOURCES, useFactory: () => createResources() },
      { provide: WORKER_FATAL, useValue: async () => {
        process.exitCode = 1;
        terminalFailure = true;
        if (app) await app.close();
      } },
    ],
  }, { abortOnError: false });
  if (terminalFailure) await app.close();
  else app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
} catch (error) { logger.error(error); process.exitCode = 1; if (app) await app.close(); }

