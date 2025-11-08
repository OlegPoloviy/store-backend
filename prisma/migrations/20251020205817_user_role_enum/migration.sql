-- CreateEnum
CREATE TYPE "public"."user_role" AS ENUM ('ADMIN', 'USER');

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "role" "public"."user_role" NOT NULL DEFAULT 'USER';
