-- CreateEnum
CREATE TYPE "LabStatus" AS ENUM ('CREATING', 'STOPPED', 'STARTING', 'RUNNING', 'STOPPING', 'ERROR');

-- CreateTable
CREATE TABLE "labs" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT,
    "namespace" TEXT NOT NULL,
    "status" "LabStatus" NOT NULL DEFAULT 'CREATING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "labs_owner_id_key" ON "labs"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "labs_namespace_key" ON "labs"("namespace");

-- CreateIndex
CREATE INDEX "labs_owner_id_idx" ON "labs"("owner_id");

-- AddForeignKey
ALTER TABLE "labs" ADD CONSTRAINT "labs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
