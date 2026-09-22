import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare } from 'bcrypt';
import { Context, Telegraf } from 'telegraf';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateSupportMessageDto } from 'src/DTO/create-support-message.dto';

type TelegramContext = Context & {
  message?: {
    text?: string;
    message_id: number;
    reply_to_message?: {
      message_id: number;
    };
    chat: {
      id: number;
    };
    from?: {
      username?: string;
    };
  };
};

@Injectable()
export class SupportChatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupportChatService.name);
  private bot?: Telegraf<TelegramContext>;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN is not configured.');
      return;
    }

    this.bot = new Telegraf<TelegramContext>(token);
    this.bot.start((ctx) => this.start(ctx));
    this.bot.on('text', (ctx) => this.onText(ctx));
    this.bot.catch(async (error, ctx) => {
      this.logTelegramError(error);

      if (this.isMissingSupportTablesError(error)) {
        await ctx.reply('Support chat database tables are not ready yet.');
        return;
      }

      await ctx.reply('Support bot could not process this message.');
    });

    void this.bot
      .launch()
      .then(() => {
        this.logger.log('Telegram support bot started.');
      })
      .catch((error) => {
        this.bot = undefined;
        const trace = error instanceof Error ? error.stack : undefined;
        this.logger.error('Failed to start Telegram support bot.', trace);
      });
  }

  onModuleDestroy() {
    this.bot?.stop();
  }

  async start(ctx: TelegramContext) {
    await ctx.reply(
      'Welcome to support chat. Use /login email password to receive customer messages.',
    );
  }

  async onText(ctx: TelegramContext) {
    const text = ctx.message?.text?.trim();

    if (!text) {
      return;
    }

    if (text.startsWith('/login')) {
      await this.loginTelegramAdmin(ctx, text);
      return;
    }

    if (text.startsWith('/start')) {
      return;
    }

    await this.handleAdminReply(ctx, text);
  }

  async createCustomerMessage(dto: CreateSupportMessageDto) {
    const messageBody = dto.message.trim();

    if (!messageBody) {
      throw new BadRequestException('Support message is required');
    }

    const conversation = dto.conversationId
      ? await this.findOpenConversation(dto.conversationId)
      : await this.prismaService.supportConversation.create({
          data: {
            customerId: dto.customerId,
            customerName: dto.customerName,
            customerEmail: dto.customerEmail,
            customerPhone: dto.customerPhone,
          },
          select: { id: true },
        });

    const message = await this.prismaService.supportMessage.create({
      data: {
        conversationId: conversation.id,
        direction: 'CUSTOMER_TO_ADMIN',
        body: messageBody,
        senderName: dto.customerName,
      },
      select: {
        id: true,
        conversationId: true,
        createdAt: true,
      },
    });

    const deliveredToAdmins = await this.notifyTelegramAdmins(
      message.id,
      conversation.id,
      messageBody,
      dto,
    );

    return {
      conversationId: conversation.id,
      messageId: message.id,
      deliveredToAdmins,
      createdAt: message.createdAt,
    };
  }

  async getConversationMessages(conversationId: string) {
    const conversation = await this.prismaService.supportConversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });

    if (!conversation) {
      throw new NotFoundException('Support conversation not found');
    }

    return this.prismaService.supportMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        direction: true,
        body: true,
        senderName: true,
        createdAt: true,
      },
    });
  }

  async getConversations() {
    return this.prismaService.supportConversation.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        customerId: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            direction: true,
            body: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async closeConversation(conversationId: string) {
    return this.prismaService.supportConversation.update({
      where: { id: conversationId },
      data: { status: 'CLOSED' },
      select: {
        id: true,
        status: true,
        updatedAt: true,
      },
    });
  }

  private async loginTelegramAdmin(ctx: TelegramContext, text: string) {
    const chatId = ctx.message?.chat.id;
    const [, email, password] = text.split(/\s+/);

    if (!chatId || !email || !password) {
      await ctx.reply('Usage: /login email password');
      return;
    }

    const user = await this.prismaService.user.findUnique({
      where: { email },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        password: true,
        role: true,
      },
    });

    if (!user || user.role !== 'ADMIN') {
      await ctx.reply('Admin credentials are invalid.');
      return;
    }

    const passwordMatches = await compare(password, user.password);

    if (!passwordMatches) {
      await ctx.reply('Admin credentials are invalid.');
      return;
    }

    await this.prismaService.supportTelegramAdmin.upsert({
      where: { userId: user.id },
      update: {
        telegramChatId: BigInt(chatId),
        telegramUsername: ctx.message?.from?.username,
      },
      create: {
        userId: user.id,
        telegramChatId: BigInt(chatId),
        telegramUsername: ctx.message?.from?.username,
      },
    });

    await ctx.reply(
      `Logged in as ${user.firstName} ${user.lastName}. Reply to customer messages here to answer them.`,
    );
  }

  private async handleAdminReply(ctx: TelegramContext, text: string) {
    const chatId = ctx.message?.chat.id;
    const replyToMessageId = ctx.message?.reply_to_message?.message_id;

    if (!chatId || !replyToMessageId) {
      await ctx.reply('Reply to a customer message from this bot to send an answer.');
      return;
    }

    const admin = await this.prismaService.supportTelegramAdmin.findUnique({
      where: { telegramChatId: BigInt(chatId) },
      select: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!admin) {
      await ctx.reply('Please login first: /login email password');
      return;
    }

    const delivery = await this.prismaService.supportTelegramDelivery.findUnique({
      where: {
        telegramChatId_telegramMessageId: {
          telegramChatId: BigInt(chatId),
          telegramMessageId: replyToMessageId,
        },
      },
      select: {
        message: {
          select: {
            conversationId: true,
            conversation: {
              select: { status: true },
            },
          },
        },
      },
    });

    if (!delivery) {
      await ctx.reply('I cannot find the customer conversation for this reply.');
      return;
    }

    if (delivery.message.conversation.status === 'CLOSED') {
      await ctx.reply('This support conversation is already closed.');
      return;
    }

    const senderName = `${admin.user.firstName} ${admin.user.lastName}`.trim();

    await this.prismaService.supportMessage.create({
      data: {
        conversationId: delivery.message.conversationId,
        direction: 'ADMIN_TO_CUSTOMER',
        body: text,
        senderName,
      },
    });

    await ctx.reply('Answer sent to the customer.');
  }

  private async notifyTelegramAdmins(
    messageId: string,
    conversationId: string,
    body: string,
    dto: CreateSupportMessageDto,
  ) {
    if (!this.bot) {
      return 0;
    }

    const admins = await this.prismaService.supportTelegramAdmin.findMany({
      select: {
        telegramChatId: true,
      },
    });

    const customerLines = [
      dto.customerName ? `Name: ${dto.customerName}` : null,
      dto.customerEmail ? `Email: ${dto.customerEmail}` : null,
      dto.customerPhone ? `Phone: ${dto.customerPhone}` : null,
      dto.customerId ? `Customer ID: ${dto.customerId}` : null,
    ].filter(Boolean);

    const notification = [
      'New customer support message',
      `Conversation: ${conversationId}`,
      ...customerLines,
      '',
      body,
      '',
      'Reply to this Telegram message to answer the customer.',
    ].join('\n');

    let delivered = 0;

    for (const admin of admins) {
      try {
        const sentMessage = await this.bot.telegram.sendMessage(
          Number(admin.telegramChatId),
          notification,
        );

        await this.prismaService.supportTelegramDelivery.create({
          data: {
            messageId,
            telegramChatId: admin.telegramChatId,
            telegramMessageId: sentMessage.message_id,
          },
        });

        delivered += 1;
      } catch {
        continue;
      }
    }

    return delivered;
  }

  private async findOpenConversation(conversationId: string) {
    const conversation = await this.prismaService.supportConversation.findFirst({
      where: {
        id: conversationId,
        status: 'OPEN',
      },
      select: { id: true },
    });

    if (!conversation) {
      throw new NotFoundException('Open support conversation not found');
    }

    return conversation;
  }

  private logTelegramError(error: unknown) {
    const trace = error instanceof Error ? error.stack : undefined;
    const message = error instanceof Error ? error.message : String(error);

    this.logger.error(`Telegram update failed: ${message}`, trace);
  }

  private isMissingSupportTablesError(error: unknown) {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const maybePrismaError = error as { code?: string; message?: string };

    return (
      maybePrismaError.code === 'P2021' &&
      Boolean(maybePrismaError.message?.includes('Support'))
    );
  }
}
