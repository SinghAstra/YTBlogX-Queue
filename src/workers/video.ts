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
    if (error instanceof Error) {
      console.log("error.stack is ", error.stack);
      console.log("error.message is ", error.message);
    }
    return [];
  }
};

export const videoWorker = new Worker(
  QUEUES.VIDEO,
  async (job) => {
    console.log("In video Worker.");
    const { videoId } = job.data;
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

      const proxies = await fetchProxies();
      console.log("proxies.length is ", proxies.length);

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
      const buffer = await response.arrayBuffer();
      const data = new TextDecoder("utf-8").decode(buffer);
      console.log("data is ", data);

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

      // 2. Find the English ASR track
      const transcriptTrack = tracks.find((t: any) => t.languageCode === "en");

      if (!transcriptTrack) {
        throw new Error("English transcript not found");
      }

      const transcriptUrl = transcriptTrack.baseUrl + "&fmt=json3";

      console.log("transcriptUrl is ", transcriptUrl);

      await logQueue.add(
        QUEUES.LOG,
        {
          videoId,
          status: VideoStatus.PENDING,
          message: "🌐 Fetching transcript data from YouTube...",
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        }
      );

      // 3. Fetch the transcript
      const transcriptRes = await fetch(transcriptUrl);
      const transcriptJson = await transcriptRes.json();

      await logQueue.add(
        QUEUES.LOG,
        {
          videoId,
          status: VideoStatus.PENDING,
          message: "📜 Transcript fetched. Cleaning up the text...",
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        }
      );

      // 4. Extract text lines
      let transcript: string = "";
      for (const event of transcriptJson.events || []) {
        if (event.segs) {
          const text = event.segs.map((seg: any) => seg.utf8).join("");
          if (text.trim() === "") continue;
          transcript += text.trim().replace(/[^\x00-\x7F]/g, "") + " ";
        }
      }

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

      const transcriptChunks = splitTranscript(transcript);

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
