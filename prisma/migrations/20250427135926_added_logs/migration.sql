/*
  Warnings:

  - You are about to drop the column `processingState` on the `Video` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Video" DROP COLUMN "processingState",
ADD COLUMN     "status" "VideoStatus" NOT NULL DEFAULT 'PENDING';

-- DropEnum
DROP TYPE "VideoProcessingState";

-- CreateTable
CREATE TABLE "Log" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "VideoStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Log_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Log" ADD CONSTRAINT "Log_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
