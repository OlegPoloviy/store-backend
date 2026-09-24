-- The Cart, Favorite and Collection models were previously created with db push,
-- but were never recorded in migration history. Keep this migration safe for both
-- a fresh shadow database and an existing database containing those objects.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'adress'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'address'
  ) THEN
    ALTER TABLE "public"."User" RENAME COLUMN "adress" TO "address";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'CartStatus' AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE "public"."CartStatus" AS ENUM ('ACTIVE', 'CHECKED_OUT', 'EXPIRED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "public"."Cart" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "anonymousId" TEXT,
    "status" "public"."CartStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."CartItem" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceSnapshot" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."Collection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."CollectionItem" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Cart_userId_idx" ON "public"."Cart"("userId");
CREATE INDEX IF NOT EXISTS "Cart_anonymousId_idx" ON "public"."Cart"("anonymousId");
CREATE INDEX IF NOT EXISTS "CartItem_cartId_idx" ON "public"."CartItem"("cartId");
CREATE INDEX IF NOT EXISTS "CartItem_productId_idx" ON "public"."CartItem"("productId");
CREATE UNIQUE INDEX IF NOT EXISTS "CartItem_cartId_productId_key" ON "public"."CartItem"("cartId", "productId");
CREATE INDEX IF NOT EXISTS "Favorite_userId_idx" ON "public"."Favorite"("userId");
CREATE INDEX IF NOT EXISTS "Favorite_productId_idx" ON "public"."Favorite"("productId");
CREATE UNIQUE INDEX IF NOT EXISTS "Favorite_userId_productId_key" ON "public"."Favorite"("userId", "productId");
CREATE UNIQUE INDEX IF NOT EXISTS "CollectionItem_collectionId_productId_key" ON "public"."CollectionItem"("collectionId", "productId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Cart_userId_fkey' AND connamespace = 'public'::regnamespace) THEN
    ALTER TABLE "public"."Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CartItem_cartId_fkey' AND connamespace = 'public'::regnamespace) THEN
    ALTER TABLE "public"."CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "public"."Cart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CartItem_productId_fkey' AND connamespace = 'public'::regnamespace) THEN
    ALTER TABLE "public"."CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Favorite_userId_fkey' AND connamespace = 'public'::regnamespace) THEN
    ALTER TABLE "public"."Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Favorite_productId_fkey' AND connamespace = 'public'::regnamespace) THEN
    ALTER TABLE "public"."Favorite" ADD CONSTRAINT "Favorite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Collection_userId_fkey' AND connamespace = 'public'::regnamespace) THEN
    ALTER TABLE "public"."Collection" ADD CONSTRAINT "Collection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CollectionItem_collectionId_fkey' AND connamespace = 'public'::regnamespace) THEN
    ALTER TABLE "public"."CollectionItem" ADD CONSTRAINT "CollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "public"."Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CollectionItem_productId_fkey' AND connamespace = 'public'::regnamespace) THEN
    ALTER TABLE "public"."CollectionItem" ADD CONSTRAINT "CollectionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
