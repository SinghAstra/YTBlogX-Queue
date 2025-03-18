export function getBlogTitleAndSummaryTotalJobsRedisKey(videoId: string) {
  return `${videoId}:totalBlogTitleAndSummaryJobs`;
}

export function getBlogTitleAndSummaryCompletedJobsRedisKey(videoId: string) {
  return `${videoId}:completedBlogTitleAndSummaryJobs`;
}
