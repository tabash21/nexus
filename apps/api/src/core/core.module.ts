import { Global, Inject, Injectable, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { API_TOKEN, CLOSE_DATABASE, DOCUMENT_REPOSITORY, type DocumentRepository } from '../tokens.js';

@Injectable()
export class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(CLOSE_DATABASE) private readonly closeDatabase: () => Promise<void>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.closeDatabase();
  }
}

export interface CoreModuleOptions {
  repo: DocumentRepository;
  token: string;
  closeDatabase?: () => Promise<void>;
}

@Global()
@Module({})
export class CoreModule {
  static forRoot(options: CoreModuleOptions): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        DatabaseShutdown,
        { provide: DOCUMENT_REPOSITORY, useValue: options.repo },
        { provide: API_TOKEN, useValue: options.token },
        { provide: CLOSE_DATABASE, useValue: options.closeDatabase ?? (async () => {}) },
      ],
      exports: [DOCUMENT_REPOSITORY, API_TOKEN, CLOSE_DATABASE, DatabaseShutdown],
    };
  }
}
