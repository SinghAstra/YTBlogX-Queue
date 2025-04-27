import { Worker } from "bullmq";
import { QUEUES } from "../lib/constants.js";
import { prisma } from "../lib/prisma.js";
import { sendProcessingUpdate } from "../lib/pusher/send-update.js";
import redisClient from "../lib/redis.js";

export const logWorker = new Worker(
  QUEUES.LOG,
  async (job) => {
    const { videoId, message, status } = job.data;

    console.log("logWorker videoId is ", videoId);

    const log = await prisma.log.create({
      data: {
        videoId,
        message,
        status,
      },
    });

    await sendProcessingUpdate(videoId, log);
  },
  {
    connection: redisClient,
    concurrency: 5,
  }
);
