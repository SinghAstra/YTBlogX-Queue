export function getBlogTitleAndSummaryTotalJobsRedisKey(videoId: string) {
  return `${videoId}:blogTitleAndSummaryTotalJobs`;
}

export function getBlogTitleAndSummaryCompletedJobsRedisKey(videoId: string) {
  return `${videoId}:blogTitleAndSummaryCompletedJobs`;
}

export function getBlogContentCompletedJobsRedisKey(videoId: string) {
  return `${videoId}:blogContentCompletedJobs`;
}

export function getBlogContentTotalJobsRedisKey(videoId: string) {
  return `${videoId}:blogContentTotalJobs`;
}

export function getGeminiRequestsThisMinuteRedisKey() {
  const now = Date.now();
  const currentMinute = Math.floor(now / 60000);
  return `${currentMinute}:rateLimitGeminiRequests`;
}

export function getGeminiTokensConsumedThisMinuteRedisKey() {
  const now = Date.now();
  const currentMinute = Math.floor(now / 60000);
  return `${currentMinute}:rateLimitGeminiTokensConsumed`;
}

export function getVideoCancelledRedisKey(videoId: string) {
  return `${videoId}:cancelled`;
}
