import { Request, Response } from "express";
import { QUEUES } from "../lib/constants";
import { videoQueue } from "../queue";

export const videoQueueController = async (req: Request, res: Response) => {
  try {
    const { videoId, userId } = req.body.auth;
    console.log("req.body.auth --videoQueueController is ", req.body.auth);

    console.log("Before videoQueue.");

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

    res.status(200).json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      console.log("error.stack is ", error.stack);
      console.log("error.message is ", error.message);
    }
    res.status(500).json({ message: "Failed to queue video job" });
  }
};
