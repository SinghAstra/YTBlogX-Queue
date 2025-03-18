import { Worker } from "bullmq";
import { QUEUES } from "../lib/constants.js";
import { generateBlogContent } from "../lib/gemini.js";
import logger from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import {
  getBlogContentCompletedJobsRedisKey,
  getBlogContentTotalJobsRedisKey,
} from "../lib/redis-keys.js";
import redis from "../lib/redis.js";

async function checkAllJobsCompleted(videoId: string) {
  const blogContentCompletedJobsRedisKey =
    getBlogContentCompletedJobsRedisKey(videoId);
  const blogContentTotalJobsRedisKey = getBlogContentTotalJobsRedisKey(videoId);

  const blogContentTotalJobs = await redis.get(blogContentTotalJobsRedisKey);
  const blogContentCompletedJobs = await redis.get(
    blogContentCompletedJobsRedisKey
  );

  console.log("-------------------------------------------------------");
  console.log("blogContentTotalJobs is ", blogContentTotalJobs);
  console.log("blogContentCompletedJobs is ", blogContentCompletedJobs);
  console.log("-------------------------------------------------------");
  if (blogContentTotalJobs === blogContentCompletedJobs) {
    logger.info("-------------------------------------------------------");
    logger.info(
      "Inside the if of blogContentTotalJobs === blogContentCompletedJobs"
    );
    logger.info("-------------------------------------------------------");

    await prisma.video.update({
      where: { id: videoId },
      data: { processingState: "COMPLETED" },
    });
  }
}

export const blogContentWorker = new Worker(
  QUEUES.BLOG_CONTENT,
  async (job) => {
    const { blog } = job.data;
    const videoId = blog.videoId;
    try {
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
    } catch (error) {
      console.log("Error in Blog Content Worker");
      if (error instanceof Error) {
        console.log("error.stack is ", error.stack);
        console.log("error.message is ", error.message);
      }

      await prisma.video.update({
        where: { id: videoId },
        data: { processingState: "FAILED" },
      });
    } finally {
      await checkAllJobsCompleted(videoId);
    }
  },
  {
    connection: redis,
    concurrency: 5,
  }
);

blogContentWorker.on("failed", (job, error) => {
  logger.error(
    `Job ${job?.id} in blog content worker failed with error: ${error.message}`
  );
});

blogContentWorker.on("completed", (job) => {
  logger.success(`Job ${job.id} in blog content worker completed successfully`);
});

// Gracefully shutdown Prisma when worker exits
const shutdown = async () => {
  console.log("Shutting down worker gracefully...");
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
