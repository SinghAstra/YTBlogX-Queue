import { VideoProcessingState } from "@prisma/client";
import { Worker } from "bullmq";
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

const fetchProxies = async () => {
  try {
    const response = await fetch(
      "https://www.proxyscrape.com/free-proxy-list",
      {
        method: "GET",
      }
    );
    const data = await response.text();
    // Parse the proxies (example: split by line and filter out unwanted formats)
    const proxyList = data.split("\n").filter((proxy) => proxy.trim());
    return proxyList;
  } catch (error) {
    console.error("Error fetching proxies:", error);
    return [];
  }
};

export const videoWorker = new Worker(
  QUEUES.VIDEO,
  async (job) => {
    console.log("In video Worker.");
    const { videoId } = job.data;

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

      const proxies = await fetchProxies();

      const proxy = proxies[Math.floor(Math.random() * proxies.length)];

      const response = await fetch(
        `https://www.youtube.com/watch?v=${video.youtubeId}`,
        {
          method: "GET",
          headers: {
            Proxy: `http://${proxy}`,
          },
        }
      );
      const data = await response.text();

      const pattern = /ytInitialPlayerResponse\s*=\s*({.+?});/;
      const match = data.match(pattern);

      if (!match || !match[1]) {
        throw new Error("ytInitialPlayerResponse not found");
      }

      const playerResponse = JSON.parse(match[1]);

      // 1. Get caption tracks
      const tracks =
        playerResponse?.captions?.playerCaptionsTracklistRenderer
          ?.captionTracks;

      if (!tracks || tracks.length === 0) {
        throw new Error("No captions found");
      }

      // 2. Find the English ASR track
      const transcriptTrack = tracks.find((t: any) => t.languageCode === "en");

      if (!transcriptTrack) {
        throw new Error("English transcript not found");
      }

      const transcriptUrl = transcriptTrack.baseUrl + "&fmt=json3";

      // 3. Fetch the transcript
      const transcriptRes = await fetch(transcriptUrl);
      const transcriptJson = await transcriptRes.json();

      // 4. Extract text lines
      let transcript: string = "";
      for (const event of transcriptJson.events || []) {
        if (event.segs) {
          const text = event.segs.map((seg: any) => seg.utf8).join("");
          if (text.trim() === "") continue;
          transcript += text.trim() + " ";
        }
      }

      transcript = transcript
        .replace(/\u2026/g, "...")
        .replace(/[^\x00-\x7F]/g, "");

      const transcriptChunks = splitTranscript(transcript);

      await sendProcessingUpdate(videoId, {
        status: VideoProcessingState.PROCESSING,
        message: `🚀 We will be generating ${transcriptChunks.length} blogs for ${video.title}. `,
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
        message: "🧠 Generating blog summaries...  ",
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
        data: { processingState: "FAILED" },
      });

      await sendProcessingUpdate(videoId, {
        status: VideoProcessingState.FAILED,
        message:
          error instanceof Error
            ? error.message
            : "⚠️ Oops! Something went wrong. Please try again later. ",
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
