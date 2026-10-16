import { Module } from '@nestjs/common';
import { RealitiesController } from './realities.controller.js';
import { RealitiesService } from './realities.service.js';

@Module({
  controllers: [RealitiesController],
  providers: [RealitiesService],
  exports: [RealitiesService],
})
export class RealitiesModule {}
