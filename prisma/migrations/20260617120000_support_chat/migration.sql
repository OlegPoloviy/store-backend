-- CreateEnum
CREATE TYPE "public"."SupportConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."SupportMessageDirection" AS ENUM ('CUSTOMER_TO_ADMIN', 'ADMIN_TO_CUSTOMER');

-- CreateTable
CREATE TABLE "public"."SupportTelegramAdmin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramChatId" BIGINT NOT NULL,
    "telegramUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTelegramAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupportConversation" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "status" "public"."SupportConversationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupportMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "public"."SupportMessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "senderName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupportTelegramDelivery" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "telegramChatId" BIGINT NOT NULL,
    "telegramMessageId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTelegramDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportTelegramAdmin_userId_key" ON "public"."SupportTelegramAdmin"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTelegramAdmin_telegramChatId_key" ON "public"."SupportTelegramAdmin"("telegramChatId");

-- CreateIndex
CREATE INDEX "SupportTelegramAdmin_telegramChatId_idx" ON "public"."SupportTelegramAdmin"("telegramChatId");

-- CreateIndex
CREATE INDEX "SupportMessage_conversationId_idx" ON "public"."SupportMessage"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTelegramDelivery_telegramChatId_telegramMessageId_key" ON "public"."SupportTelegramDelivery"("telegramChatId", "telegramMessageId");

-- CreateIndex
CREATE INDEX "SupportTelegramDelivery_messageId_idx" ON "public"."SupportTelegramDelivery"("messageId");

-- AddForeignKey
ALTER TABLE "public"."SupportTelegramAdmin" ADD CONSTRAINT "SupportTelegramAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupportMessage" ADD CONSTRAINT "SupportMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupportTelegramDelivery" ADD CONSTRAINT "SupportTelegramDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
