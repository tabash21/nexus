import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { HttpErrorFilter } from './common/http-error.filter.js';
import type { ItemRepository } from './tokens.js';

export async function buildApp(
  repo: ItemRepository,
  token: string,
  options: {
    logger?: boolean;
    closeDatabase?: () => Promise<void>;
  } = {},
) {
  if (token.length < 24) throw new Error('API_TOKEN must contain at least 24 characters');

  const app = await NestFactory.create(
    AppModule.register({ repo, token, closeDatabase: options.closeDatabase }),
    {
      logger: options.logger ? ['log', 'error', 'warn'] : false,
      abortOnError: false,
    },
  );

  app.useGlobalFilters(new HttpErrorFilter());
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  return app;
}
