import { Log } from "@prisma/client";
import pusherServer from "./server.js";

export const sendProcessingUpdate = async (videoId: string, log: Log) => {
  const channel = `video-${videoId}`;
  await pusherServer.trigger(channel, "processing-update", log);
};
