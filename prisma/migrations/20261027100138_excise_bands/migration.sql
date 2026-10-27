-- AlterTable
ALTER TABLE "excise_rates" ADD COLUMN     "abv_max_bp" INTEGER,
ADD COLUMN     "abv_min_bp" INTEGER,
ADD COLUMN     "plato_max_tenths" INTEGER,
ADD COLUMN     "plato_min_tenths" INTEGER,
ADD COLUMN     "sparkling" BOOLEAN;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "sparkling" BOOLEAN NOT NULL DEFAULT false;
