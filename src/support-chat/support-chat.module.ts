import { Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TelegrafModule.forRoot({
      token: ConfigService,
    }),
  ],
})
export class SupportChatModule {}
