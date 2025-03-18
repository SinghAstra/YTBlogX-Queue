import { Worker } from "bullmq";
import { QUEUES } from "../lib/constants.js";
import logger from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import redis from "../lib/redis.js";

export const videoWorker = new Worker(
  QUEUES.VIDEO,
  async (job) => {
    const { videoId, videoURL } = job.data;

    try {
      console.log("Inside worker/video.ts");
      console.log("job.data is ", job.data);
      return { status: "SUCCESS", message: "Started Processing Video" };
    } catch (error) {
      console.log("Error in Video Worker");
      if (error instanceof Error) {
        logger.error(`Repository worker error: ${error.message}`);
        logger.error(`Stack: ${error.stack}`);
      }
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 5,
  }
);

videoWorker.on("failed", (job, error) => {
  logger.error(`Job ${job?.id} in worker failed with error: ${error.message}`);
});

videoWorker.on("completed", (job) => {
  logger.success(`Job ${job.id} in video worker completed successfully`);
});

// Gracefully shutdown Prisma when worker exits
const shutdown = async () => {
  console.log("Shutting down worker gracefully...");
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
