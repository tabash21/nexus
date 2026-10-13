import { Module } from '@nestjs/common';
import { PlatformsController } from './platforms.controller.js';
import { PlatformsService } from './platforms.service.js';

@Module({
  controllers: [PlatformsController],
  providers: [PlatformsService],
  exports: [PlatformsService],
})
export class PlatformsModule {}
