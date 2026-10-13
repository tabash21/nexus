import { Module, type DynamicModule } from '@nestjs/common';
import { CoreModule, type CoreModuleOptions } from './core/core.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { HealthModule } from './health/health.module.js';
import { BearerGuard } from './common/auth.guard.js';

export type AppModuleOptions = CoreModuleOptions;

@Module({
  imports: [DocumentsModule, HealthModule],
  providers: [BearerGuard],
})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(options),
        DocumentsModule,
        HealthModule,
      ],
      providers: [BearerGuard],
    };
  }
}
