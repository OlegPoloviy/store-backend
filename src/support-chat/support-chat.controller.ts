import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CreateSupportMessageDto } from 'src/DTO/create-support-message.dto';
import { AdminGuard } from 'src/guards/admin.guard';
import { SupportChatService } from './support-chat.service';

@Controller('support-chat')
export class SupportChatController {
  constructor(private readonly supportChatService: SupportChatService) {}

  @Post('messages')
  async createCustomerMessage(@Body() dto: CreateSupportMessageDto) {
    return this.supportChatService.createCustomerMessage(dto);
  }

  @Get('conversations/:conversationId/messages')
  async getConversationMessages(@Param('conversationId') conversationId: string) {
    return this.supportChatService.getConversationMessages(conversationId);
  }

  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @Get('conversations')
  async getConversations() {
    return this.supportChatService.getConversations();
  }

  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @Post('conversations/:conversationId/close')
  async closeConversation(@Param('conversationId') conversationId: string) {
    return this.supportChatService.closeConversation(conversationId);
  }
}
