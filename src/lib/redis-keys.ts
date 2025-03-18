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
