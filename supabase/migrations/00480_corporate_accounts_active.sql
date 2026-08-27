-- 00480_corporate_accounts_active.sql
--
-- Corporate accounts had no way to be switched off. Deleting one is not an
-- option: its invoices are referenced by myDATA transmissions and must be
-- retained (docs/05), and its members' rides stay on the books. So the panel
-- needs a deactivation flag, the same shape the other catalogues use.
--
-- Additive and back-compatible — existing rows become active, which is what
-- they already were in practice.

alter table corporate_accounts
  add column if not exists active boolean not null default true;

comment on column corporate_accounts.active is
  'Deactivated companies stop accruing new rides but keep their invoice history.';
