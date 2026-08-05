-- Email verification, password recovery and minimal administrator RBAC.
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');
CREATE TYPE "EmailCodePurpose" AS ENUM ('register', 'resetPassword');

ALTER TABLE "User"
  ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'user',
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "disabledAt" TIMESTAMP(3);

-- Existing password accounts predate mandatory verification; preserve access
-- while requiring verification for every account created after this migration.
UPDATE "User"
SET "emailVerifiedAt" = "createdAt"
WHERE "passwordHash" IS NOT NULL;

CREATE TABLE "EmailVerificationCode" (
  "id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "purpose" "EmailCodePurpose" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailVerificationCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailVerificationCode_email_purpose_createdAt_idx"
  ON "EmailVerificationCode"("email", "purpose", "createdAt" DESC);

CREATE TABLE "AdminAuditLog" (
  "id" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "targetUserId" UUID,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAuditLog_actorId_createdAt_idx"
  ON "AdminAuditLog"("actorId", "createdAt" DESC);
CREATE INDEX "AdminAuditLog_targetUserId_createdAt_idx"
  ON "AdminAuditLog"("targetUserId", "createdAt" DESC);

ALTER TABLE "AdminAuditLog"
  ADD CONSTRAINT "AdminAuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminAuditLog"
  ADD CONSTRAINT "AdminAuditLog_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
