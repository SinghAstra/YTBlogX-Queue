import { VideoStatus } from "@prisma/client";
import { Worker } from "bullmq";
import {
  BATCH_SIZE_FOR_BLOG_TITLE_AND_SUMMARY,
  CONCURRENT_WORKERS,
  QUEUES,
} from "../lib/constants.js";
import { prisma } from "../lib/prisma.js";
import {
  getBlogTitleAndSummaryCompletedJobsRedisKey,
  getBlogTitleAndSummaryTotalJobsRedisKey,
} from "../lib/redis-keys.js";
import redisClient from "../lib/redis.js";
import { splitTranscript } from "../lib/split-transcript.js";
import { blogTitleAndSummaryQueue, logQueue } from "../queue/index.js";

const batchSize = BATCH_SIZE_FOR_BLOG_TITLE_AND_SUMMARY;

export const videoWorker = new Worker(
  QUEUES.VIDEO,
  async (job) => {
    console.log("In video Worker.");
    const { videoId, userId } = job.data;
    console.log("videoId is ", videoId);

    const blogTitleAndSummaryTotalJobsRedisKey =
      getBlogTitleAndSummaryTotalJobsRedisKey(videoId);
    const blogTitleAndSummaryCompletedJobsRedisKey =
      getBlogTitleAndSummaryCompletedJobsRedisKey(videoId);
    try {
      const video = await prisma.video.findFirst({
        where: { id: videoId },
      });

      console.log("video is ", video);

      if (!video) {
        throw new Error("Video Not Found.");
      }

      await logQueue.add(
        QUEUES.LOG,
        {
          videoId,
          status: VideoStatus.PENDING,
          message: "🔍 Looking for English subtitles...",
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        }
      );

      await logQueue.add(
        QUEUES.LOG,
        {
          videoId,
          status: VideoStatus.PENDING,
          message: "📚 Splitting transcript into blog-sized chunks...",
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        }
      );

      const transcriptChunks = splitTranscript(video.transcript);

      await logQueue.add(
        QUEUES.LOG,
        {
          videoId,
          status: VideoStatus.PROCESSING,
          message: `🚀 We will be generating ${transcriptChunks.length} blogs for ${video.title}. `,
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        }
      );

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

      await logQueue.add(
        QUEUES.LOG,
        {
          videoId,
          status: VideoStatus.PENDING,
          message: "📝 Saved transcript chunks as blog entries.",
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        }
      );

      await logQueue.add(
        QUEUES.LOG,
        {
          videoId,
          status: VideoStatus.PROCESSING,
          message: "📦 Preparing batches to generate titles and summaries...",
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        }
      );

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

      const parsedBlogs = blogs.map((blog) => {
        return { id: blog.id };
      });

      console.log("parsedBlogs are ", parsedBlogs);

      const totalBlogTitleAndSummaryJobs = Math.ceil(blogs.length / batchSize);

      redisClient.incrby(
        blogTitleAndSummaryTotalJobsRedisKey,
        totalBlogTitleAndSummaryJobs
      );
      redisClient.set(blogTitleAndSummaryCompletedJobsRedisKey, 0);

      for (let i = 0; i < blogs.length; i += batchSize) {
        const batch = blogs.slice(i, i + batchSize);

        await blogTitleAndSummaryQueue.add(
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
    } catch (error) {
      if (error instanceof Error) {
        console.log("error.stack is ", error.stack);
        console.log("error.message is ", error.message);
      }

      await prisma.video.update({
        where: { id: videoId },
        data: { status: "FAILED" },
      });

      await logQueue.add(
        QUEUES.LOG,
        {
          videoId,
          status: VideoStatus.FAILED,
          message:
            error instanceof Error
              ? `⚠️ ${error.message}`
              : "⚠️ Oops! Something went wrong. Please try again later. ",
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        }
      );
    }
  },
  {
    connection: redisClient,
    concurrency: CONCURRENT_WORKERS,
  }
);

videoWorker.on("failed", (job, error) => {
  if (error instanceof Error) {
    console.log("error.stack is ", error.stack);
    console.log("error.message is ", error.message);
  }
  console.log("Video worker failed!");
});

videoWorker.on("completed", () => {
  console.log("Video Worker Completed Successfully.");
});

// Gracefully shutdown Prisma when worker exits
const shutdown = async () => {
  console.log("Shutting down video worker gracefully...");
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
