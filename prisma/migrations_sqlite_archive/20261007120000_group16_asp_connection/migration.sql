-- Group 16: AspProvider + AspConnection (old Mongo AspProvider / AspConnection parity).

CREATE TABLE "AspProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "apiVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "AspProvider_code_key" ON "AspProvider"("code");

CREATE TABLE "AspConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "legalEntityId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "credentialsRef" TEXT,
    "participantId" TEXT,
    "endpointScheme" TEXT,
    "connectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AspConnection_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AspConnection_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AspProvider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AspConnection_legalEntityId_idx" ON "AspConnection"("legalEntityId");
CREATE INDEX "AspConnection_providerId_idx" ON "AspConnection"("providerId");
CREATE INDEX "AspConnection_status_idx" ON "AspConnection"("status");
