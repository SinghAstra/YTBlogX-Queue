import { VideoStatus } from "@prisma/client";
import { Worker } from "bullmq";
import { BLOG_CONTENT_WORKERS, QUEUES } from "../lib/constants.js";
import { generateBlogContent } from "../lib/gemini.js";
import { prisma } from "../lib/prisma.js";
import {
  getBlogContentCompletedJobsRedisKey,
  getBlogContentTotalJobsRedisKey,
  getVideoCancelledRedisKey,
} from "../lib/redis-keys.js";
import redisClient from "../lib/redis.js";
import { logQueue } from "../queue/index.js";

async function checkAllJobsCompleted(videoId: string) {
  const blogContentCompletedJobsRedisKey =
    getBlogContentCompletedJobsRedisKey(videoId);
  const blogContentTotalJobsRedisKey = getBlogContentTotalJobsRedisKey(videoId);

  const blogContentTotalJobs = await redisClient.get(
    blogContentTotalJobsRedisKey
  );
  const blogContentCompletedJobs = await redisClient.get(
    blogContentCompletedJobsRedisKey
  );

  console.log("-------------------------------------------------------");
  console.log("blogContentTotalJobs is ", blogContentTotalJobs);
  console.log("blogContentCompletedJobs is ", blogContentCompletedJobs);
  console.log("-------------------------------------------------------");
  if (blogContentTotalJobs === blogContentCompletedJobs) {
    console.log("-------------------------------------------------------");
    console.log(
      "Inside the if of blogContentTotalJobs === blogContentCompletedJobs"
    );
    console.log("-------------------------------------------------------");

    await prisma.video.update({
      where: { id: videoId },
      data: { status: "COMPLETED" },
    });

    await logQueue.add(
      QUEUES.LOG,
      {
        videoId,
        status: VideoStatus.COMPLETED,
        message: "🚀 Generated all the blogs",
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
        status: VideoStatus.COMPLETED,
        message: "⏱️ Give me a second I will be redirecting you ...! ",
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
}

export const blogContentWorker = new Worker(
  QUEUES.BLOG_CONTENT,
  async (job) => {
    const { blog, videoId } = job.data;
    const isCancelled = await redisClient.get(
      getVideoCancelledRedisKey(videoId)
    );
    if (isCancelled === "true") {
      console.log(`❌ blogContentWorker for ${videoId} has been cancelled`);
      return;
    }
    const blogContentCompletedJobsRedisKey =
      getBlogContentCompletedJobsRedisKey(videoId);
    try {
      await logQueue.add(
        QUEUES.LOG,
        {
          videoId,
          status: VideoStatus.PROCESSING,
          message: `⏳ Generating blog for ${blog.title}...`,
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        }
      );
      const video = await prisma.video.findUnique({ where: { id: videoId } });
      const allBlogs = await prisma.blog.findMany({
        where: { videoId },
        select: { summary: true },
      });

      const allSummaries = allBlogs.map((blog) => blog.summary);
      const parsedSummary = allSummaries.join("\n");

      if (!video) {
        throw new Error("Video Not Found.");
      }

      console.log("Inside worker/blog-content.ts");
      console.log("job.data is ", job.data);

      const blogData = await generateBlogContent(
        video.overview || "No Video Overview",
        parsedSummary,
        blog.transcript
      );

      await prisma.blog.update({
        where: { id: blog.id },
        data: {
          content: blogData,
        },
      });

      await redisClient.incr(blogContentCompletedJobsRedisKey);
    } catch (error) {
      console.log("Error in Blog Content Worker");
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
    concurrency: BLOG_CONTENT_WORKERS,
  }
);

blogContentWorker.on("failed", (job, error) => {
  if (error instanceof Error) {
    console.log("error.stack is ", error.stack);
    console.log("error.message is ", error.message);
  }
  console.log("Blog Content Worker failed!");
});

blogContentWorker.on("completed", () => {
  console.log("Blog Content Worker Completed Successfully.");
});
// Gracefully shutdown Prisma when worker exits
const shutdown = async () => {
  console.log("Shutting down blog content worker gracefully...");
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
