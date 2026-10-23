-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'IMPORT';

-- AlterTable
ALTER TABLE "relations" ADD COLUMN     "external_ref" TEXT;

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'XAF',
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "software" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "entries" INTEGER NOT NULL DEFAULT 0,
    "accounts_created" INTEGER NOT NULL DEFAULT 0,
    "relations_created" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_administration_id_file_hash_idx" ON "import_batches"("administration_id", "file_hash");

-- CreateIndex
CREATE INDEX "relations_administration_id_external_ref_idx" ON "relations"("administration_id", "external_ref");

-- Row-level security for the new tenant table (see *_row_level_security).
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "import_batches" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));
