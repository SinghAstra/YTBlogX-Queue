import {
  blogContentQueue,
  blogTitleAndSummaryQueue,
  logQueue,
} from "../queue/index.js";
import { getVideoCancelledRedisKey } from "./redis-keys.js";
import redisClient from "./redis.js";

export async function cancelAllVideoJobs(videoId: string) {
  const videoCancelledRedisKey = getVideoCancelledRedisKey(videoId);
  redisClient.set(videoCancelledRedisKey, "true");
  console.log(`✅ Updated videoCancelledRedisKey`);

  // 1. Fetch all waiting/delayed jobs in blog title And summary queue
  const blogTitleAndSummaryJobs = await blogTitleAndSummaryQueue.getJobs([
    "waiting",
    "delayed",
  ]);
  console.log(
    "📋blogTitleAndSummaryJobs.length is",
    blogTitleAndSummaryJobs.length
  );

  for (const job of blogTitleAndSummaryJobs) {
    if (job.data.videoId === videoId) {
      await job.remove();
    }
  }

  // 2. Fetch all waiting/delayed jobs in blog content queue
  const blogContentJobs = await blogContentQueue.getJobs([
    "waiting",
    "delayed",
  ]);
  console.log("📝blogContentJobs.length is", blogContentJobs.length);

  for (const job of blogContentJobs) {
    if (job.data.videoId === videoId) {
      await job.remove();
    }
  }

  // 3. Repeat for logQueue
  const logJobs = await logQueue.getJobs(["waiting", "delayed"]);
  console.log("📦logJobs.length is", logJobs.length);

  for (const job of logJobs) {
    if (job.data.videoId === videoId) {
      await job.remove();
    }
  }

  console.log(`✅ Cancelled all jobs for videoId: ${videoId}`);
}
