import 'reflect-metadata';
import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BearerGuard } from './auth.guard.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { HealthController } from './health.controller.js';
import { HttpErrorFilter } from './http-error.filter.js';
import { API_TOKEN, CLOSE_DATABASE, DOCUMENT_REPOSITORY, type DocumentRepository } from './tokens.js';

@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(CLOSE_DATABASE) private readonly closeDatabase: () => Promise<void>) {}
  async onApplicationShutdown() { await this.closeDatabase(); }
}
@Module({})
class ApiModule {}

export async function buildApp(repo: DocumentRepository, token: string, options: {
  logger?: boolean; closeDatabase?: () => Promise<void>;
} = {}) {
  if (token.length < 24) throw new Error('API_TOKEN must contain at least 24 characters');
  const app = await NestFactory.create({
    module: ApiModule,
    controllers: [DocumentsController, HealthController],
    providers: [
      DocumentsService, BearerGuard, DatabaseShutdown,
      { provide: DOCUMENT_REPOSITORY, useValue: repo },
      { provide: API_TOKEN, useValue: token },
      { provide: CLOSE_DATABASE, useValue: options.closeDatabase ?? (async () => {}) },
    ],
  }, { logger: options.logger ? ['log', 'error', 'warn'] : false, abortOnError: false });
  app.useGlobalFilters(new HttpErrorFilter());
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  return app;
}

