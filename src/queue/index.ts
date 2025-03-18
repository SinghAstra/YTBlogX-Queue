import { Queue } from "bullmq";
import { QUEUES } from "../lib/constants";
import redis from "../lib/redis";

export const videoQueue = new Queue(QUEUES.VIDEO, {
  connection: redis,
});

export const blogTitleAndSummaryQueue = new Queue(
  QUEUES.BLOG_TITLE_AND_SUMMARY,
  {
    connection: redis,
  }
);

export const blogContentQueue = new Queue(QUEUES.BLOG_CONTENT, {
  connection: redis,
});
