import { Blog } from "@prisma/client";
import { Worker } from "bullmq";
import { QUEUES } from "../lib/constants.js";
import { generateTitleAndSummaries } from "../lib/gemini.js";
import logger from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import redis from "../lib/redis.js";

// Function to update summaries in the database
async function updateTitlesAndSummaries(
  summaries: { id: string; summary: string; title: string }[]
) {
  const updatePromises = summaries.map(({ id, summary, title }) =>
    prisma.blog.update({
      where: { id },
      data: { summary, title },
    })
  );

  return await prisma.$transaction(updatePromises);
}

export const blogTitleAndSummaryWorker = new Worker(
  QUEUES.BLOG_TITLE_AND_SUMMARY,
  async (job) => {
    const { videoId } = job.data;
    try {
      const blogs: Blog[] = job.data.blogs;

      // Generate summaries
      const titlesAndSummaries = await generateTitleAndSummaries(blogs);

      // Validate and update summaries
      if (titlesAndSummaries && Array.isArray(titlesAndSummaries)) {
        const validTitlesAndSummaries = titlesAndSummaries.filter(
          (titlesAndSummary) =>
            titlesAndSummary &&
            typeof titlesAndSummary.id === "string" &&
            typeof titlesAndSummary.summary === "string" &&
            typeof titlesAndSummary.title === "string" &&
            blogs.some((blog) => blog.id === titlesAndSummary.id)
        );

        if (validTitlesAndSummaries.length > 0) {
          // Update database with transaction
          await updateTitlesAndSummaries(validTitlesAndSummaries);
          console.log(
            `Successfully updated ${validTitlesAndSummaries.length} blogs with title and summary`
          );
        }
      }

      return {
        success: true,
        message: `Processed ${blogs.length} transcripts for video ${videoId}`,
      };
    } catch (error) {
      if (error instanceof Error) {
        console.log("error.stack is ", error.stack);
        console.log("error.message is ", error.message);
      }

      // Update video processing state to failed
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

blogTitleAndSummaryWorker.on("failed", (job, error) => {
  logger.error(
    `Job ${job?.id} in blog title and summary worker failed with error: ${error.message}`
  );
});

blogTitleAndSummaryWorker.on("completed", (job) => {
  logger.success(
    `Job ${job.id} in blog title and summary worker completed successfully`
  );
});

// Gracefully shutdown Prisma when worker exits
const shutdown = async () => {
  console.log("Shutting down worker gracefully...");
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
