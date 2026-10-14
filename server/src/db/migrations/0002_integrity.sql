-- Integrity rules enforced by the database itself, so no code path (API, import script,
-- manual SQL) can leave the books unbalanced or change a locked period.

-- 1. Double entry: every voucher's ledger entries must sum to zero. Deferred to COMMIT so a
--    voucher can be written line by line inside one transaction.
CREATE FUNCTION check_voucher_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  diff numeric;
  vid integer;
BEGIN
  IF TG_OP = 'DELETE' THEN vid := OLD.voucher_id; ELSE vid := NEW.voucher_id; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO diff FROM ledger_entries WHERE voucher_id = vid;
  IF diff <> 0 THEN
    RAISE EXCEPTION 'Voucher is not balanced: debit and credit differ by %', round(abs(diff), 2)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_voucher_balanced();

-- 2. Period lock and books-beginning date: no voucher may be created, altered or deleted on a
--    date on or before companies.locked_until, or dated before the books begin.
CREATE FUNCTION check_voucher_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  c companies%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.deleting_company', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT * INTO c FROM companies WHERE id = OLD.company_id;
    IF c.locked_until IS NOT NULL AND OLD.date <= c.locked_until THEN
      RAISE EXCEPTION 'Books are locked up to %; this voucher cannot be changed', to_char(c.locked_until, 'DD-Mon-YYYY')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT * INTO c FROM companies WHERE id = NEW.company_id;
    IF c.locked_until IS NOT NULL AND NEW.date <= c.locked_until THEN
      RAISE EXCEPTION 'Books are locked up to %; choose a later date', to_char(c.locked_until, 'DD-Mon-YYYY')
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.date < c.books_from THEN
      RAISE EXCEPTION 'Date is before books beginning from %', to_char(c.books_from, 'DD-Mon-YYYY')
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER vouchers_period_lock
  BEFORE INSERT OR UPDATE OR DELETE ON vouchers
  FOR EACH ROW EXECUTE FUNCTION check_voucher_period();

-- 3. Reserved masters (the 28 predefined groups, Profit & Loss A/c, reserved voucher types)
--    cannot be deleted.
CREATE FUNCTION protect_reserved() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_reserved AND current_setting('app.deleting_company', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '"%" is a predefined master and cannot be deleted', OLD.name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER groups_protect BEFORE DELETE ON groups FOR EACH ROW EXECUTE FUNCTION protect_reserved();
CREATE TRIGGER ledgers_protect BEFORE DELETE ON ledgers FOR EACH ROW EXECUTE FUNCTION protect_reserved();
CREATE TRIGGER voucher_types_protect BEFORE DELETE ON voucher_types FOR EACH ROW EXECUTE FUNCTION protect_reserved();
