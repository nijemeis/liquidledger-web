-- Row-level security: every bookkeeping table is only visible inside a
-- transaction that has set `app.administration_id` (see src/lib/db.ts
-- withTenant). Platform code that must see across tenants (seeding, platform
-- admin statistics) sets `app.rls_bypass = 'on'` for its own transaction only.
--
-- FORCE makes the policies apply to the table owner too, so the application
-- may connect as the owning role. The role must NOT be a superuser and must
-- not have BYPASSRLS.

CREATE OR REPLACE FUNCTION app_tenant_visible(admin_id text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT admin_id = current_setting('app.administration_id', true)
      OR current_setting('app.rls_bypass', true) = 'on'
$$;

ALTER TABLE "ledger_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_accounts" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "relations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "relations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "relations" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "products" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "product_prices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_prices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "product_prices" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "warehouses" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_movements" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "sales_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales_invoices" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "sales_invoice_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_invoice_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales_invoice_lines" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "purchase_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_invoices" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "purchase_invoice_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_invoice_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_invoice_lines" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "documents" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "receipts" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "booking_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "booking_rules" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bank_accounts" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "bank_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_transactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bank_transactions" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "shipments" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "customs_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customs_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customs_documents" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "journal_entries" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "journal_lines" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "tax_returns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_returns" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tax_returns" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

ALTER TABLE "sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sequences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sequences" USING (app_tenant_visible(administration_id)) WITH CHECK (app_tenant_visible(administration_id));

-- Journal entries are append-only once posted; corrections are reversing
-- entries. Block updates of amounts/accounts on posted lines.
CREATE OR REPLACE FUNCTION app_block_journal_line_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'journal lines are immutable; post a reversing entry instead';
END $$;
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION app_block_journal_line_update();

-- Entries dated inside a closed period cannot be inserted or removed.
CREATE OR REPLACE FUNCTION app_check_period_open() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE locked date;
DECLARE d date;
DECLARE a text;
BEGIN
  IF TG_OP = 'DELETE' THEN d := OLD.date; a := OLD.administration_id; ELSE d := NEW.date; a := NEW.administration_id; END IF;
  SELECT locked_through INTO locked FROM administrations WHERE id = a;
  IF locked IS NOT NULL AND d <= locked THEN
    RAISE EXCEPTION 'period is closed through %', locked;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_entries_period_open BEFORE INSERT OR UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION app_check_period_open();

