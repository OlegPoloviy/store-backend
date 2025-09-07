/*
  Warnings:

  - You are about to drop the column `material` on the `Product` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[uniqueIdentifier]` on the table `Product` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Product" DROP COLUMN "material",
ADD COLUMN     "assemblyRequired" BOOLEAN,
ADD COLUMN     "careInstructions" TEXT,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "craftsmanshipDetails" TEXT[],
ADD COLUMN     "creationDate" TIMESTAMP(3),
ADD COLUMN     "depth" DECIMAL(10,2),
ADD COLUMN     "designInspiration" TEXT,
ADD COLUMN     "designer" TEXT,
ADD COLUMN     "features" TEXT[],
ADD COLUMN     "finish" TEXT,
ADD COLUMN     "handmade" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "height" DECIMAL(10,2),
ADD COLUMN     "originOfMaterial" TEXT,
ADD COLUMN     "pattern" TEXT,
ADD COLUMN     "primaryMaterial" TEXT,
ADD COLUMN     "seatingCapacity" INTEGER,
ADD COLUMN     "secondaryMaterials" TEXT[],
ADD COLUMN     "storageCapacity" TEXT,
ADD COLUMN     "story" TEXT,
ADD COLUMN     "style" TEXT,
ADD COLUMN     "texture" TEXT,
ADD COLUMN     "uniqueIdentifier" TEXT,
ADD COLUMN     "unitOfMeasure" VARCHAR(10),
ADD COLUMN     "warranty" TEXT,
ADD COLUMN     "weight" DECIMAL(10,2),
ADD COLUMN     "weightUnit" VARCHAR(10),
ADD COLUMN     "width" DECIMAL(10,2),
ADD COLUMN     "woodTreatment" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Product_uniqueIdentifier_key" ON "public"."Product"("uniqueIdentifier");
