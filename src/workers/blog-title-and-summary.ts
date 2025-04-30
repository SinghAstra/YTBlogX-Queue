import { Blog, VideoStatus } from "@prisma/client";
import { Worker } from "bullmq";
import { CONCURRENT_WORKERS, QUEUES } from "../lib/constants.js";
import {
  generateTitleAndSummaries,
  generateVideoOverview,
} from "../lib/gemini.js";
import { prisma } from "../lib/prisma.js";
import {
  getBlogContentCompletedJobsRedisKey,
  getBlogContentTotalJobsRedisKey,
  getBlogTitleAndSummaryCompletedJobsRedisKey,
  getBlogTitleAndSummaryTotalJobsRedisKey,
  getVideoCancelledRedisKey,
} from "../lib/redis-keys.js";
import redisClient from "../lib/redis.js";
import { blogContentQueue, logQueue } from "../queue/index.js";

// Function to update summaries in the database
async function updateTitlesAndSummaries(
  summaries: { id: string; summary: string; title: string }[],
  videoId: string
) {
  summaries.map(async (summary) => {
    await logQueue.add(
      QUEUES.LOG,
      {
        videoId,
        status: VideoStatus.PROCESSING,
        message: `✍️ Generating title and summary for ${summary.title}`,
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
      }
    );
  });
  const updatePromises = summaries.map(({ id, summary, title }) => {
    return prisma.blog.update({
      where: { id },
      data: { summary, title },
    });
  });

  return await prisma.$transaction(updatePromises);
}

async function checkAllJobsCompleted(videoId: string) {
  const blogTitleAndSummaryTotalJobsRedisKey =
    getBlogTitleAndSummaryTotalJobsRedisKey(videoId);
  const blogTitleAndSummaryCompletedJobsRedisKey =
    getBlogTitleAndSummaryCompletedJobsRedisKey(videoId);

  const blogContentCompletedJobsRedisKey =
    getBlogContentCompletedJobsRedisKey(videoId);
  const blogContentTotalJobsRedisKey = getBlogContentTotalJobsRedisKey(videoId);

  const blogTitleAndSummaryTotalJobs = await redisClient.get(
    blogTitleAndSummaryTotalJobsRedisKey
  );
  const blogTitleAndSummaryCompletedJobs = await redisClient.get(
    blogTitleAndSummaryCompletedJobsRedisKey
  );

  console.log("-------------------------------------------------------");
  console.log("blogTitleAndSummaryTotalJobs is ", blogTitleAndSummaryTotalJobs);
  console.log(
    "blogTitleAndSummaryCompletedJobs is ",
    blogTitleAndSummaryCompletedJobs
  );
  console.log("-------------------------------------------------------");
  if (blogTitleAndSummaryTotalJobs === blogTitleAndSummaryCompletedJobs) {
    console.log("-------------------------------------------------------");
    console.log(
      "Inside the if of blogTitleAndSummaryTotalJobs === blogTitleAndSummaryCompletedJobs"
    );
    console.log("-------------------------------------------------------");

    await logQueue.add(
      QUEUES.LOG,
      {
        videoId,
        status: VideoStatus.PROCESSING,
        message: "🎉 Generated Summary for all the blogs! ",
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
      }
    );

    // Generate video overview
    const overview = await generateVideoOverview(videoId);

    await prisma.video.update({
      where: { id: videoId },
      data: { overview },
    });

    const blogs = await prisma.blog.findMany({
      where: {
        videoId,
      },
    });

    redisClient.set(blogContentCompletedJobsRedisKey, 0);
    redisClient.set(blogContentTotalJobsRedisKey, blogs.length);

    blogs.map(async (blog) => {
      await blogContentQueue.add(
        QUEUES.BLOG_CONTENT,
        { blog, videoId },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        }
      );
    });
  }
}

export const blogTitleAndSummaryWorker = new Worker(
  QUEUES.BLOG_TITLE_AND_SUMMARY,
  async (job) => {
    console.log("In blogTitleAndSummaryWorker");
    const { videoId } = job.data;
    const isCancelled = await redisClient.get(
      getVideoCancelledRedisKey(videoId)
    );
    if (isCancelled === "true") {
      console.log(
        `❌ blogTitleAndSummaryWorker for ${videoId} has been cancelled`
      );
      return;
    }
    const blogTitleAndSummaryCompletedJobsRedisKey =
      getBlogTitleAndSummaryCompletedJobsRedisKey(videoId);

    try {
      const blogs: Blog[] = job.data.blogs;

      // Generate summaries
      const titlesAndSummaries = await generateTitleAndSummaries(blogs);

      // Update database with transaction
      await updateTitlesAndSummaries(titlesAndSummaries, videoId);
      console.log(
        `Successfully updated ${titlesAndSummaries.length} blogs with title and summary`
      );

      await redisClient.incr(blogTitleAndSummaryCompletedJobsRedisKey);
    } catch (error) {
      if (error instanceof Error) {
        console.log("error.stack is ", error.stack);
        console.log("error.message is ", error.message);
      }

      await logQueue.add(
        QUEUES.LOG,
        {
          videoId,
          status: VideoStatus.FAILED,
          message:
            error instanceof Error
              ? `⚠️ Oops ${error.message}`
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

      // Update video processing state to failed
      await prisma.video.update({
        where: { id: videoId },
        data: { status: "FAILED" },
      });
    } finally {
      await checkAllJobsCompleted(videoId);
    }
  },
  {
    connection: redisClient,
    concurrency: CONCURRENT_WORKERS,
  }
);

blogTitleAndSummaryWorker.on("failed", (job, error) => {
  if (error instanceof Error) {
    console.log("error.stack is ", error.stack);
    console.log("error.message is ", error.message);
  }
  console.log("Blog Title And Summary Worker failed!");
});

blogTitleAndSummaryWorker.on("completed", () => {
  console.log("Blog Title And Summary Worker Completed Successfully.");
});

// Gracefully shutdown Prisma when worker exits
const shutdown = async () => {
  console.log("Shutting down blog title and summary worker gracefully...");
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
