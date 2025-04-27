import { VideoStatus } from "@prisma/client";
import { Request, Response } from "express";
import { QUEUES } from "../lib/constants";
import { logQueue, videoQueue } from "../queue";

export const addToVideoQueue = async (req: Request, res: Response) => {
  try {
    const { videoId, userId } = req.body.auth;
    console.log("req.body.auth --videoQueueController is ", req.body.auth);

    console.log("Before videoQueue.");

    await logQueue.add(
      QUEUES.LOG,
      {
        videoId,
        status: VideoStatus.FAILED,
        message: "🎥We're downloading the transcript. Hang tight! ",
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
      }
    );

    console.log("After sendProcessingUpdate.");

    await videoQueue.add(
      QUEUES.VIDEO,
      {
        videoId,
        userId,
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
      }
    );

    console.log("After videoQueue.add.");

    res.status(200).json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      console.log("error.stack is ", error.stack);
      console.log("error.message is ", error.message);
    }
    res.status(500).json({ message: "Failed to queue video job" });
  }
};
