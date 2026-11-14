CREATE TYPE "ProductAvailability" AS ENUM ('IN_STOCK', 'OUT_OF_STOCK', 'PREORDER', 'BACKORDER');
CREATE TYPE "ProductionDayType" AS ENUM ('BUSINESS', 'CALENDAR');

ALTER TABLE "Product"
    ADD COLUMN "sku" TEXT,
    ADD COLUMN "brand" TEXT NOT NULL DEFAULT 'KarpatMaster',
    ADD COLUMN "locale" TEXT,
    ADD COLUMN "slug" TEXT,
    ADD COLUMN "link" TEXT,
    ADD COLUMN "originalPrice" DECIMAL(10, 2),
    ADD COLUMN "translations" JSONB,
    ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "availability" "ProductAvailability",
    ADD COLUMN "availabilityDate" TIMESTAMP(3),
    ADD COLUMN "gtin" TEXT,
    ADD COLUMN "mpn" TEXT,
    ADD COLUMN "identifierExists" BOOLEAN,
    ADD COLUMN "isMadeToOrder" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "productionTimeMinDays" INTEGER,
    ADD COLUMN "productionTimeMaxDays" INTEGER,
    ADD COLUMN "productionDayType" "ProductionDayType",
    ADD CONSTRAINT "Product_production_time_check" CHECK (
        ("productionTimeMinDays" IS NULL AND "productionTimeMaxDays" IS NULL AND "productionDayType" IS NULL)
        OR (
            "isMadeToOrder" AND "productionTimeMinDays" IS NOT NULL
            AND "productionTimeMaxDays" IS NOT NULL AND "productionDayType" IS NOT NULL
            AND "productionTimeMinDays" >= 0 AND "productionTimeMaxDays" >= "productionTimeMinDays"
        )
    );

CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

ALTER TABLE "ProductImage"
    ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "managed" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "ProductImportSource" (
    "productId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    CONSTRAINT "ProductImportSource_pkey" PRIMARY KEY ("productId", "format"),
    CONSTRAINT "ProductImportSource_productId_fkey" FOREIGN KEY ("productId")
        REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "ProductImportSource" ENABLE ROW LEVEL SECURITY;
