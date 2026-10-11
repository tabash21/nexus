import { Module, type DynamicModule } from '@nestjs/common';
import { WorkerService } from './worker.service.js';
import { WORKER_FATAL, WORKER_RESOURCES, type FatalHandler } from './worker.tokens.js';
import { createResources, type WorkerResources } from './worker.resources.js';

export interface WorkerModuleOptions {
  resources?: WorkerResources;
  fatal?: FatalHandler;
}

@Module({})
export class WorkerModule {
  static register(options?: WorkerModuleOptions): DynamicModule {
    return {
      module: WorkerModule,
      providers: [
        WorkerService,
        {
          provide: WORKER_RESOURCES,
          useFactory: () => options?.resources ?? createResources(),
        },
        {
          provide: WORKER_FATAL,
          useValue: options?.fatal ?? (async () => {}),
        },
      ],
      exports: [WorkerService],
    };
  }
}
