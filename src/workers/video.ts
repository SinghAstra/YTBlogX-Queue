import { Worker } from "bullmq";
import { YoutubeTranscript } from "youtube-transcript";
import {
  BATCH_SIZE_FOR_BLOG_TITLE_AND_SUMMARY,
  QUEUES,
} from "../lib/constants.js";
import logger from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { getBlogTitleAndSummaryTotalJobsRedisKey } from "../lib/redis-keys.js";
import redis from "../lib/redis.js";
import { splitTranscript } from "../lib/split-transcript.js";
import { blogTitleAndSummaryQueue } from "../queue/index.js";

const batchSize = BATCH_SIZE_FOR_BLOG_TITLE_AND_SUMMARY;

export const videoWorker = new Worker(
  QUEUES.VIDEO,
  async (job) => {
    const { videoId } = job.data;
    const blogTitleAndSummaryTotalJobsRedisKey =
      getBlogTitleAndSummaryTotalJobsRedisKey(videoId);
    try {
      console.log("Inside worker/video.ts");
      console.log("job.data is ", job.data);

      const video = await prisma.video.findFirst({
        where: { id: videoId },
      });

      if (!video) {
        throw new Error("Video Not Found.");
      }

      const transcriptData = await YoutubeTranscript.fetchTranscript(
        video.youtubeId
      );
      const transcript = transcriptData.map((entry) => entry.text).join(" ");
      const transcriptChunks = splitTranscript(transcript);

      console.log("transcriptChunks.length is ", transcriptChunks.length);

      const createBlogWithTranscript = transcriptChunks.map((chunk, index) => {
        return prisma.blog.create({
          data: {
            transcript: chunk,
            videoId: video.id,
            part: index + 1,
          },
        });
      });

      await prisma.$transaction(createBlogWithTranscript);

      // Get all blogs for the video that don't have summaries yet
      const blogs = await prisma.blog.findMany({
        where: {
          videoId,
          summary: null,
        },
        select: {
          id: true,
          transcript: true,
        },
      });

      console.log(
        `Found ${blogs.length} transcripts to summarize for video ${videoId}`
      );

      const totalBlogTitleAndSummaryJobs = Math.ceil(blogs.length / batchSize);

      redis.incrby(
        blogTitleAndSummaryTotalJobsRedisKey,
        totalBlogTitleAndSummaryJobs
      );

      for (let i = 0; i < blogs.length; i += batchSize) {
        const batch = blogs.slice(i, i + batchSize);
        console.log(
          `Adding batch ${
            i / batchSize + 1
          } of ${totalBlogTitleAndSummaryJobs} to blog title and summary`
        );

        blogTitleAndSummaryQueue.add(
          QUEUES.BLOG_TITLE_AND_SUMMARY,
          { videoId: video.id, blogs: batch },
          {
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 5000,
            },
          }
        );
      }

      return { success: true, message: "Started Processing Video" };
    } catch (error) {
      console.log("Error in Video Worker");
      if (error instanceof Error) {
        console.log("error.stack is ", error.stack);
        console.log("error.message is ", error.message);
      }

      await prisma.video.update({
        where: { id: videoId },
        data: { processingState: "FAILED" },
      });

      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
  {
    connection: redis,
    concurrency: 5,
  }
);

videoWorker.on("failed", (job, error) => {
  logger.error(
    `Job ${job?.id} in video worker failed with error: ${error.message}`
  );
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
