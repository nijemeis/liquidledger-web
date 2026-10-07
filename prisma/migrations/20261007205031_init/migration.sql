-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('STARTER', 'BUSINESS', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "VatPeriod" AS ENUM ('MONTHLY', 'QUARTERLY');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'BOOKKEEPER', 'WAREHOUSE', 'ACCOUNTANT', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SUPER_ADMIN', 'SUPPORT', 'FINANCE');

-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('USER', 'STAFF');

-- CreateEnum
CREATE TYPE "EmailTokenPurpose" AS ENUM ('INVITE', 'RESET_PASSWORD', 'LOCK_ACCOUNT', 'STAFF_SETUP');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'STAFF', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SubscriptionInvoiceStatus" AS ENUM ('PAID', 'OPEN', 'FAILED', 'VOID');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('WINE', 'BEER', 'SPIRITS', 'FORTIFIED', 'WATER', 'SOFT');

-- CreateEnum
CREATE TYPE "ExciseBasis" AS ENUM ('HL_PRODUCT', 'HL_PER_ABV', 'HL_PER_PLATO', 'HL_PURE_ALCOHOL', 'NONE');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST');

-- CreateEnum
CREATE TYPE "RelationKind" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH');

-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('DOMESTIC', 'EU_B2B', 'EXPORT');

-- CreateEnum
CREATE TYPE "WarehouseKind" AS ENUM ('BONDED', 'DUTY_PAID', 'IN_TRANSIT');

-- CreateEnum
CREATE TYPE "StockReason" AS ENUM ('OPENING', 'PURCHASE', 'SALE', 'TRANSFER', 'RELEASE_FOR_CONSUMPTION', 'SAMPLE', 'LOSS', 'COUNT');

-- CreateEnum
CREATE TYPE "SalesInvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'CREDITED');

-- CreateEnum
CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('TO_APPROVE', 'BOOKED', 'PAID');

-- CreateEnum
CREATE TYPE "PurchaseVatTreatment" AS ENUM ('DOMESTIC', 'EU_ACQUISITION', 'IMPORT', 'EU_SERVICES', 'NONE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaidBy" AS ENUM ('CARD', 'BANK', 'OWN');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('UNSORTED', 'SUGGESTED', 'BOOKED');

-- CreateEnum
CREATE TYPE "BankTxStatus" AS ENUM ('UNRECONCILED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "ShipmentDirection" AS ENUM ('IMPORT', 'EXPORT', 'EU', 'DOMESTIC');

-- CreateEnum
CREATE TYPE "ShipmentStage" AS ENUM ('BOOKED', 'IN_TRANSIT', 'AT_CUSTOMS', 'ARRIVED');

-- CreateEnum
CREATE TYPE "CustomsDocType" AS ENUM ('IMPORT_DECLARATION', 'EXPORT_DECLARATION', 'E_AD', 'T1', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomsDocStatus" AS ENUM ('DRAFT', 'AWAITING', 'ACCEPTED', 'RELEASED', 'MISSING', 'REJECTED');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('OPENING', 'SALES', 'PURCHASE', 'BANK', 'RECEIPT', 'STOCK', 'EXCISE', 'MANUAL', 'PAYROLL_IMPORT');

-- CreateEnum
CREATE TYPE "TaxReturnType" AS ENUM ('VAT', 'EXCISE', 'ICP');

-- CreateEnum
CREATE TYPE "TaxReturnStatus" AS ENUM ('DRAFT', 'READY', 'FILED');

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "vat_number" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'BUSINESS',
    "status" "ClientStatus" NOT NULL DEFAULT 'TRIAL',
    "trial_ends_at" TIMESTAMP(3),
    "modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "data_region" TEXT NOT NULL DEFAULT 'eu-central-1',
    "session_timeout_minutes" INTEGER,
    "last_active_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administrations" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "base_currency" TEXT NOT NULL DEFAULT 'EUR',
    "chart_template" TEXT NOT NULL DEFAULT 'NL-RGS',
    "ledger_language" TEXT NOT NULL DEFAULT 'nl',
    "fiscal_year_start" INTEGER NOT NULL DEFAULT 1,
    "vat_period" "VatPeriod" NOT NULL DEFAULT 'QUARTERLY',
    "vat_number" TEXT,
    "coc_number" TEXT,
    "excise_licence_no" TEXT,
    "excise_authority" TEXT,
    "address_line" TEXT,
    "postcode" TEXT,
    "city" TEXT,
    "email" TEXT,
    "iban" TEXT,
    "invoice_prefix" TEXT NOT NULL DEFAULT 'INV',
    "locked_through" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "administrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "password_hash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "lock_reason" TEXT,
    "phone" TEXT,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT false,
    "totp_secret_enc" TEXT,
    "totp_enabled_at" TIMESTAMP(3),
    "totp_last_step" INTEGER,
    "last_sign_in_at" TIMESTAMP(3),
    "last_administration_id" TEXT,
    "password_changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "password_hash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_sign_in_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkeys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "staff_id" TEXT,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "device_type" TEXT,
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL DEFAULT 'Passkey',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "kind" "SessionKind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT,
    "staff_id" TEXT,
    "administration_id" TEXT,
    "support_session_id" TEXT,
    "auth_method" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_timeout_min" INTEGER NOT NULL DEFAULT 30,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_challenges" (
    "id" TEXT NOT NULL,
    "kind" "SessionKind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT,
    "staff_id" TEXT,
    "stage" TEXT NOT NULL,
    "webauthn" TEXT,
    "sms_code_hash" TEXT,
    "sms_sent_at" TIMESTAMP(3),
    "data" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "trusted_until" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "staff_id" TEXT,
    "purpose" "EmailTokenPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "data" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "support_sessions" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "support_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" TEXT,
    "actor_label" TEXT NOT NULL,
    "client_id" TEXT,
    "administration_id" TEXT,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "subscription_invoices" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "SubscriptionInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    "provider_ref" TEXT,

    CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "excise_rates" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "basis" "ExciseBasis" NOT NULL,
    "rate_cents" INTEGER NOT NULL,
    "valid_from" DATE NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "excise_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_nl" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "rgs_code" TEXT,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relations" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "kind" "RelationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "type_label" TEXT,
    "country" TEXT NOT NULL,
    "city" TEXT,
    "address_line" TEXT,
    "postcode" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "vat_number" TEXT,
    "vies_valid" BOOLEAN,
    "vies_checked_at" TIMESTAMP(3),
    "vies_name" TEXT,
    "excise_status" TEXT,
    "excise_number" TEXT,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 14,
    "default_price_list" TEXT,
    "tax_regime_override" "TaxRegime",
    "iban" TEXT,
    "notes" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "producer" TEXT,
    "region" TEXT,
    "origin_country" TEXT,
    "category" "ProductCategory" NOT NULL,
    "volume_ml" INTEGER NOT NULL,
    "abv_bp" INTEGER NOT NULL DEFAULT 0,
    "plato_tenths" INTEGER,
    "vintage" TEXT,
    "units_per_case" INTEGER NOT NULL DEFAULT 6,
    "cases_per_pallet" INTEGER,
    "ean" TEXT,
    "cn_code" TEXT,
    "emcs_code" TEXT,
    "deposit_cents" INTEGER NOT NULL DEFAULT 0,
    "reorder_level" INTEGER,
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_prices" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "list" TEXT NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WarehouseKind" NOT NULL,
    "city" TEXT,
    "excise_warehouse_no" TEXT,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "from_warehouse_id" TEXT,
    "to_warehouse_id" TEXT,
    "qty" INTEGER NOT NULL,
    "reason" "StockReason" NOT NULL,
    "unit_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "excise_released" BOOLEAN NOT NULL DEFAULT false,
    "excise_cents" INTEGER NOT NULL DEFAULT 0,
    "document_type" TEXT,
    "document_id" TEXT,
    "document_ref" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "number" TEXT,
    "customer_id" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "tax_regime" "TaxRegime" NOT NULL,
    "status" "SalesInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "warehouse_id" TEXT,
    "net_cents" INTEGER NOT NULL DEFAULT 0,
    "excise_cents" INTEGER NOT NULL DEFAULT 0,
    "deposit_cents" INTEGER NOT NULL DEFAULT 0,
    "vat_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "paid_cents" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT,
    "notes" TEXT,
    "sent_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "last_reminder_at" TIMESTAMP(3),
    "journal_entry_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_lines" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "product_id" TEXT,
    "description" TEXT NOT NULL,
    "qty_units" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "net_cents" INTEGER NOT NULL,
    "excise_cents" INTEGER NOT NULL DEFAULT 0,
    "excise_formula" TEXT,
    "deposit_cents" INTEGER NOT NULL DEFAULT 0,
    "vat_rate_bp" INTEGER NOT NULL DEFAULT 0,
    "vat_code" TEXT NOT NULL,
    "vat_cents" INTEGER NOT NULL DEFAULT 0,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "supplier_name" TEXT NOT NULL,
    "supplier_country" TEXT,
    "number" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "due_date" DATE,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "fx_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "fx_date" DATE,
    "total_source_cents" INTEGER NOT NULL DEFAULT 0,
    "net_cents" INTEGER NOT NULL DEFAULT 0,
    "vat_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "paid_cents" INTEGER NOT NULL DEFAULT 0,
    "vat_treatment" "PurchaseVatTreatment" NOT NULL DEFAULT 'DOMESTIC',
    "status" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'TO_APPROVE',
    "warehouse_id" TEXT,
    "shipment_id" TEXT,
    "order_ref" TEXT,
    "document_id" TEXT,
    "ocr_confidence" INTEGER,
    "warning" TEXT,
    "payment_scheduled_at" TIMESTAMP(3),
    "booked_at" TIMESTAMP(3),
    "journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_lines" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "product_id" TEXT,
    "account_code" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unit_price_src_cents" INTEGER NOT NULL,
    "amount_src_cents" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "vat_rate_bp" INTEGER NOT NULL DEFAULT 0,
    "vat_cents" INTEGER NOT NULL DEFAULT 0,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage" TEXT NOT NULL DEFAULT 'db',
    "storage_key" TEXT,
    "data" BYTEA,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "extraction" JSONB,
    "error" TEXT,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "supplier" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "category_key" TEXT,
    "vat_override" TEXT,
    "paid_by" "PaidBy" NOT NULL DEFAULT 'CARD',
    "employee_name" TEXT,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'UNSORTED',
    "suggestion_reason" TEXT,
    "rule_id" TEXT,
    "document_id" TEXT,
    "journal_entry_id" TEXT,
    "claim_paid_at" TIMESTAMP(3),
    "payroll" JSONB,
    "booked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_rules" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "match_type" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "category_key" TEXT,
    "account_code" TEXT,
    "vat_rate_bp" INTEGER,
    "times_used" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iban" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "account_code" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "opening_balance_cents" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "counterparty" TEXT NOT NULL,
    "counterparty_iban" TEXT,
    "description" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "BankTxStatus" NOT NULL DEFAULT 'UNRECONCILED',
    "match_type" TEXT,
    "match_id" TEXT,
    "match_label" TEXT,
    "journal_entry_id" TEXT,
    "import_hash" TEXT NOT NULL,
    "reconciled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "direction" "ShipmentDirection" NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "goods" TEXT NOT NULL,
    "eta" DATE,
    "stage" "ShipmentStage" NOT NULL DEFAULT 'BOOKED',
    "stage_note" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "block_reason" TEXT,
    "relation_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customs_documents" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "type" "CustomsDocType" NOT NULL,
    "reference" TEXT,
    "shipment_id" TEXT,
    "sales_invoice_id" TEXT,
    "status" "CustomsDocStatus" NOT NULL DEFAULT 'DRAFT',
    "document_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customs_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "source" "JournalSource" NOT NULL,
    "source_id" TEXT,
    "reversal_of_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "debit_cents" INTEGER NOT NULL DEFAULT 0,
    "credit_cents" INTEGER NOT NULL DEFAULT 0,
    "vat_code" TEXT,
    "vat_base_cents" INTEGER,
    "relation_id" TEXT,
    "description" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_returns" (
    "id" TEXT NOT NULL,
    "administration_id" TEXT NOT NULL,
    "type" "TaxReturnType" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "boxes" JSONB NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "status" "TaxReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "filed_ref" TEXT,
    "filed_at" TIMESTAMP(3),
    "filed_by_id" TEXT,

    CONSTRAINT "tax_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequences" (
    "administration_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("administration_id","name")
);

-- CreateIndex
CREATE INDEX "administrations_client_id_idx" ON "administrations"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_administration_id_idx" ON "memberships"("administration_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_administration_id_key" ON "memberships"("user_id", "administration_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "passkeys_credential_id_key" ON "passkeys"("credential_id");

-- CreateIndex
CREATE INDEX "passkeys_user_id_idx" ON "passkeys"("user_id");

-- CreateIndex
CREATE INDEX "passkeys_staff_id_idx" ON "passkeys"("staff_id");

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_staff_id_idx" ON "sessions"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_challenges_token_hash_key" ON "auth_challenges"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_token_hash_key" ON "user_devices"("token_hash");

-- CreateIndex
CREATE INDEX "user_devices_user_id_idx" ON "user_devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_tokens_user_id_idx" ON "email_tokens"("user_id");

-- CreateIndex
CREATE INDEX "support_sessions_client_id_idx" ON "support_sessions"("client_id");

-- CreateIndex
CREATE INDEX "audit_events_at_idx" ON "audit_events"("at");

-- CreateIndex
CREATE INDEX "audit_events_client_id_at_idx" ON "audit_events"("client_id", "at");

-- CreateIndex
CREATE INDEX "audit_events_administration_id_at_idx" ON "audit_events"("administration_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoices_number_key" ON "subscription_invoices"("number");

-- CreateIndex
CREATE INDEX "subscription_invoices_client_id_idx" ON "subscription_invoices"("client_id");

-- CreateIndex
CREATE INDEX "excise_rates_country_category_valid_from_idx" ON "excise_rates"("country", "category", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_administration_id_code_key" ON "ledger_accounts"("administration_id", "code");

-- CreateIndex
CREATE INDEX "relations_administration_id_kind_idx" ON "relations"("administration_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "products_administration_id_sku_key" ON "products"("administration_id", "sku");

-- CreateIndex
CREATE INDEX "product_prices_product_id_idx" ON "product_prices"("product_id");

-- CreateIndex
CREATE INDEX "stock_movements_administration_id_product_id_idx" ON "stock_movements"("administration_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_movements_administration_id_at_idx" ON "stock_movements"("administration_id", "at");

-- CreateIndex
CREATE INDEX "sales_invoices_administration_id_status_idx" ON "sales_invoices"("administration_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_administration_id_number_key" ON "sales_invoices"("administration_id", "number");

-- CreateIndex
CREATE INDEX "sales_invoice_lines_invoice_id_idx" ON "sales_invoice_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "purchase_invoices_administration_id_status_idx" ON "purchase_invoices"("administration_id", "status");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_invoice_id_idx" ON "purchase_invoice_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "documents_administration_id_created_at_idx" ON "documents"("administration_id", "created_at");

-- CreateIndex
CREATE INDEX "receipts_administration_id_status_idx" ON "receipts"("administration_id", "status");

-- CreateIndex
CREATE INDEX "bank_transactions_administration_id_status_idx" ON "bank_transactions"("administration_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_bank_account_id_import_hash_key" ON "bank_transactions"("bank_account_id", "import_hash");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_administration_id_ref_key" ON "shipments"("administration_id", "ref");

-- CreateIndex
CREATE INDEX "journal_entries_administration_id_date_idx" ON "journal_entries"("administration_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_administration_id_number_key" ON "journal_entries"("administration_id", "number");

-- CreateIndex
CREATE INDEX "journal_lines_administration_id_account_code_idx" ON "journal_lines"("administration_id", "account_code");

-- CreateIndex
CREATE INDEX "journal_lines_entry_id_idx" ON "journal_lines"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_returns_administration_id_type_period_start_key" ON "tax_returns"("administration_id", "type", "period_start");

-- AddForeignKey
ALTER TABLE "administrations" ADD CONSTRAINT "administrations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_administration_id_fkey" FOREIGN KEY ("administration_id") REFERENCES "administrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
