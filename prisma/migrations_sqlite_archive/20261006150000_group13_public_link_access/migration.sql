-- Group 13 Phase A: public-link access fields on CreditNote (old Mongo parity).
-- Invoice already has publicAccess / verification from Group 8.

ALTER TABLE "CreditNote" ADD COLUMN "publicAccessCreditNote" JSONB;
ALTER TABLE "CreditNote" ADD COLUMN "publicAccessRefundDocument" JSONB;
ALTER TABLE "CreditNote" ADD COLUMN "verification" JSONB;
