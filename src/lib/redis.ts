import dotenv from "dotenv";
import { Redis } from "ioredis";

dotenv.config();

const redisURL = process.env.REDIS_URL;

if (!redisURL) {
  throw new Error("Missing REDIS_URL environment variable");
}

const redis = new Redis(redisURL, {
  maxRetriesPerRequest: null,
});

redis.on("connect", () => {
  console.log("Connected to Redis");
});

redis.on("error", () => {
  console.error("Redis Error while connecting.");
});

export default redis;
