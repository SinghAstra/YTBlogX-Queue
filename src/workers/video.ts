import { VideoProcessingState } from "@prisma/client";
import { Worker } from "bullmq";
import { YoutubeTranscript } from "youtube-transcript";
import {
  BATCH_SIZE_FOR_BLOG_TITLE_AND_SUMMARY,
  QUEUES,
} from "../lib/constants.js";
import { prisma } from "../lib/prisma.js";
import { sendProcessingUpdate } from "../lib/pusher/send-update.js";
import {
  getBlogTitleAndSummaryCompletedJobsRedisKey,
  getBlogTitleAndSummaryTotalJobsRedisKey,
} from "../lib/redis-keys.js";
import redisClient from "../lib/redis.js";
import { splitTranscript } from "../lib/split-transcript.js";
import { blogTitleAndSummaryQueue } from "../queue/index.js";

const batchSize = BATCH_SIZE_FOR_BLOG_TITLE_AND_SUMMARY;

export const videoWorker = new Worker(
  QUEUES.VIDEO,
  async (job) => {
    const { videoId } = job.data;

    await sendProcessingUpdate(videoId, {
      status: VideoProcessingState.PROCESSING,
      message: "🎥We're preparing the transcript. Hang tight! ",
    });

    const blogTitleAndSummaryTotalJobsRedisKey =
      getBlogTitleAndSummaryTotalJobsRedisKey(videoId);
    const blogTitleAndSummaryCompletedJobsRedisKey =
      getBlogTitleAndSummaryCompletedJobsRedisKey(videoId);
    try {
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

      await sendProcessingUpdate(videoId, {
        status: VideoProcessingState.PROCESSING,
        message: `We’ve split the transcript into ${transcriptChunks.length} parts. Moving on! 🚀`,
      });

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

      await sendProcessingUpdate(videoId, {
        status: VideoProcessingState.PROCESSING,
        message: "✍️Generating blog summaries...  ",
      });

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
        data: { processingState: "FAILED" },
      });

      await sendProcessingUpdate(videoId, {
        status: VideoProcessingState.FAILED,
        message: "⚠️ Oops! Something went wrong. Please try again later. ",
      });
    }
  },
  {
    connection: redisClient,
    concurrency: 5,
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
