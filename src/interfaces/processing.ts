import { VideoProcessingState } from "@prisma/client";

export interface ProcessingUpdate {
  status: VideoProcessingState;
  message: string;
}


