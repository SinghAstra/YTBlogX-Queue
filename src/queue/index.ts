import { Queue } from "bullmq";
import { QUEUES } from "../lib/constants";
import redisClient from "../lib/redis";

export const videoQueue = new Queue(QUEUES.VIDEO, {
  connection: redisClient,
});

export const blogTitleAndSummaryQueue = new Queue(
  QUEUES.BLOG_TITLE_AND_SUMMARY,
  {
    connection: redisClient,
  }
);

export const blogContentQueue = new Queue(QUEUES.BLOG_CONTENT, {
  connection: redisClient,
});

export const logQueue = new Queue(QUEUES.LOG, {
  connection: redisClient,
});
