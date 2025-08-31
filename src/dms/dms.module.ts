import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DmsService } from './dms.service';

@Module({
  imports: [ConfigModule],
  providers: [DmsService],
  exports: [DmsService],
})
export class DmsModule {}
