/*
  Warnings:

  - You are about to drop the column `launch_url` on the `services` table. All the data in the column will be lost.
  - Added the required column `lab_component` to the `services` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "sectors" ADD COLUMN     "template_name" TEXT;

-- AlterTable
ALTER TABLE "services" DROP COLUMN "launch_url",
ADD COLUMN     "lab_component" TEXT NOT NULL;
