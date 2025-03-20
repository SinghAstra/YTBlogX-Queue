import dotenv from "dotenv";
import Pusher from "pusher";

dotenv.config();
const PUSHER_APP_ID = process.env.PUSHER_APP_ID;
const PUSHER_APP_KEY = process.env.PUSHER_APP_KEY;
const PUSHER_SECRET = process.env.PUSHER_SECRET;
const PUSHER_CLUSTER = process.env.PUSHER_CLUSTER;

if (!PUSHER_APP_ID || !PUSHER_APP_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) {
  throw new Error("Missing PUSHER environment variable");
}

const pusherServer = new Pusher({
  appId: PUSHER_APP_ID,
  key: PUSHER_APP_KEY,
  secret: PUSHER_SECRET,
  cluster: PUSHER_CLUSTER,
  useTLS: true,
});

export default pusherServer;
