# YTBlogX-Queue

This repository manages asynchronous video processing and blog post generation for YTBlogX using BullMQ queues, interacting with a Prisma database and leveraging the Gemini API for content creation. It includes robust error handling, token verification, and a system for cleaning up jobs.

## 🧰 Technology Stack

| Technology | Purpose/Role                                                   |
| ---------- | -------------------------------------------------------------- |
| Express.js | Web framework for creating RESTful APIs.                       |
| BullMQ     | Job queue for managing asynchronous tasks.                     |
| Prisma     | ORM for database interactions.                                 |
| Redis      | In-memory data store for caching and queue management.         |
| TypeScript | Static typing for JavaScript.                                  |
| JWT        | JSON Web Tokens for authentication and authorization.          |
| Gemini API | Google's large language model API for generating blog content. |
| PostgreSQL | Relational database for persistent data storage.               |
| Pusher     | Real-time messaging service for sending processing updates.    |

## 📁 File Structure and Purpose

| File Path                                                                   | Description                                                                                     |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `package.json`                                                              | Project dependencies, scripts, and metadata.                                                    |
| `package-lock.json`                                                         | Exact versions of project dependencies.                                                         |
| `tsconfig.json`                                                             | TypeScript compiler configuration.                                                              |
| `prisma/schema.prisma`                                                      | Prisma schema defining the data model.                                                          |
| `prisma/migrations/migration_lock.toml`                                     | Prisma migration lock file.                                                                     |
| `prisma/migrations/20250320070700_updated_verification_state/migration.sql` | SQL migration creating video processing states enum and Account table.                          |
| `prisma/migrations/20250427135926_added_logs/migration.sql`                 | SQL migration restructuring Video table and adding Log table.                                   |
| `src/index.ts`                                                              | Main application entry point.                                                                   |
| `src/controllers/queue.ts`                                                  | Contains functions for adding video processing tasks to the queue and logging queue operations. |
| `src/controllers/clean.ts`                                                  | Contains functions for handling cleaning up jobs.                                               |
| `src/routes/queue.ts`                                                       | Express route for adding videos to the queue (uses `verify-service-token` middleware).          |
| `src/routes/clean.ts`                                                       | Express routes for cleaning jobs (uses `verify-clean-job-token` middleware).                    |
| `src/middleware/verify-service-token.ts`                                    | Middleware for verifying service tokens using JWT.                                              |
| `src/middleware/verify-clean-job-token.ts`                                  | Middleware for verifying JWT tokens for clean job requests.                                     |
| `src/queue/index.ts`                                                        | Defines and exports BullMQ queues for video processing, blog post generation, and logging.      |
| `src/lib/constants.ts`                                                      | Defines constants related to queues, batch sizes, and concurrent workers.                       |
| `src/lib/redis.ts`                                                          | Establishes a connection to Redis.                                                              |
| `src/lib/split-transcript.ts`                                               | Splits transcripts into smaller chunks.                                                         |
| `src/lib/gemini.ts`                                                         | Interacts with the Google Gemini API.                                                           |
| `src/lib/prompt.ts`                                                         | Defines functions for generating system prompts for Gemini.                                     |
| `src/lib/prisma.ts`                                                         | Configures and provides a Prisma client instance.                                               |
| `src/lib/redis-keys.ts`                                                     | Defines functions for generating Redis keys.                                                    |
| `src/lib/cancel-jobs.ts`                                                    | Provides functionality to cancel video jobs.                                                    |
| `src/lib/pusher/server.ts`                                                  | Initializes a Pusher server instance.                                                           |
| `src/lib/pusher/send-update.ts`                                             | Sends processing updates to a Pusher channel.                                                   |
| `src/workers/video.ts`                                                      | BullMQ worker for processing video data.                                                        |
| `src/workers/blog-title-and-summary.ts`                                     | BullMQ worker for generating blog titles and summaries.                                         |
| `src/workers/blog-content.ts`                                               | BullMQ worker for processing blog content generation.                                           |
| `src/workers/log.ts`                                                        | BullMQ worker for processing log entries.                                                       |
