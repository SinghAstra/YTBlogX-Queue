import { VideoStatus } from "@prisma/client";
import { Worker } from "bullmq";
import { cancelAllVideoJobs } from "../lib/cancel-jobs.js";
import { CONCURRENT_WORKERS, QUEUES } from "../lib/constants.js";
import { prisma } from "../lib/prisma.js";
import { sendProcessingUpdate } from "../lib/pusher/send-update.js";
import { getVideoCancelledRedisKey } from "../lib/redis-keys.js";
import redisClient from "../lib/redis.js";

export const logWorker = new Worker(
  QUEUES.LOG,
  async (job) => {
    const { videoId, message, status } = job.data;

    const isCancelled = await redisClient.get(
      getVideoCancelledRedisKey(videoId)
    );
    if (isCancelled === "true") {
      console.log(`❌ Log Worker for ${videoId} has been cancelled`);
      return;
    }

    console.log("logWorker videoId is ", videoId);

    const log = await prisma.log.create({
      data: {
        videoId,
        message,
        status,
      },
    });

    await sendProcessingUpdate(videoId, log);

    if (status === VideoStatus.FAILED) {
      console.log("--------------------------------------------------------");
      console.log(
        "logWorker status is FAILED, cancelling all jobs for videoId : ",
        videoId
      );
      console.log("log.message is ", log.message);
      console.log("--------------------------------------------------------");
      await cancelAllVideoJobs(videoId);
    }
  },
  {
    connection: redisClient,
    concurrency: CONCURRENT_WORKERS,
  }
);
