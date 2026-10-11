import { Module, Inject, Injectable, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { HealthController } from './health.controller.js';
import { BearerGuard } from './auth.guard.js';
import { API_TOKEN, CLOSE_DATABASE, DOCUMENT_REPOSITORY, type DocumentRepository } from './tokens.js';

@Injectable()
export class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(CLOSE_DATABASE) private readonly closeDatabase: () => Promise<void>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.closeDatabase();
  }
}

export interface AppModuleOptions {
  repo: DocumentRepository;
  token: string;
  closeDatabase?: () => Promise<void>;
}

@Module({
  controllers: [DocumentsController, HealthController],
  providers: [DocumentsService, BearerGuard, DatabaseShutdown],
})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      providers: [
        { provide: DOCUMENT_REPOSITORY, useValue: options.repo },
        { provide: API_TOKEN, useValue: options.token },
        { provide: CLOSE_DATABASE, useValue: options.closeDatabase ?? (async () => {}) },
      ],
    };
  }
}
