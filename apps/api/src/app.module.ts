import { Module, type DynamicModule } from '@nestjs/common';
import { CoreModule, type CoreModuleOptions } from './core/core.module.js';
import { ItemsModule } from './items/items.module.js';
import { HealthModule } from './health/health.module.js';
import { SourcesModule } from './sources/sources.module.js';
import { AuthorsModule } from './authors/authors.module.js';
import { PlatformsModule } from './platforms/platforms.module.js';
import { RealitiesModule } from './realities/realities.module.js';
import { TopicsModule } from './topics/topics.module.js';
import { EntitiesModule } from './entities/entities.module.js';
import { CollectionQueriesModule } from './queries/queries.module.js';
import { StatsModule } from './stats/stats.module.js';
import { BearerGuard } from './common/auth.guard.js';

export type AppModuleOptions = CoreModuleOptions;

const featureModules = [
  ItemsModule,
  HealthModule,
  SourcesModule,
  AuthorsModule,
  PlatformsModule,
  RealitiesModule,
  TopicsModule,
  EntitiesModule,
  CollectionQueriesModule,
  StatsModule,
];

@Module({
  imports: featureModules,
  providers: [BearerGuard],
})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(options),
        ...featureModules,
      ],
      providers: [BearerGuard],
    };
  }
}
