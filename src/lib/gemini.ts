import { GoogleGenAI, Type } from "@google/genai";
import { prisma } from "./prisma.js";
import {
  generateBlogContentSystemPrompt,
  generateTitleAndSummarySystemPrompt,
  generateVideoOverviewSystemPrompt,
} from "./prompt.js";
import { getGeminiRequestsThisMinuteRedisKey } from "./redis-keys.js";
import redis from "./redis.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required.");
}

const model = "gemini-1.5-flash";

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const REQUEST_LIMIT = 15;

export async function trackRequest() {
  const geminiRequestsCountKey = getGeminiRequestsThisMinuteRedisKey();

  const result = await redis
    .multi()
    .incr(geminiRequestsCountKey)
    .expire(geminiRequestsCountKey, 60)
    .exec();

  if (!result) {
    throw new Error(
      "Redis connection failed during updating tokens consumed and request count"
    );
  }

  const [requests, tokens] = result.map(([error, response]) => {
    if (error) throw error;
    return response;
  });

  return { requests, tokens };
}

export async function checkLimits() {
  const geminiRequestsCountKey = getGeminiRequestsThisMinuteRedisKey();

  const requests = await redis.get(geminiRequestsCountKey);

  return {
    requests: parseInt(requests ?? "0"),
    requestsExceeded: parseInt(requests ?? "0") >= REQUEST_LIMIT,
  };
}

async function sleep(time: number) {
  console.log(`Sleeping for ${2000 * time}ms...`);
  await new Promise((resolve) => setTimeout(resolve, time * 2000));
}

export async function handleRateLimit() {
  const limitsResponse = await checkLimits();

  console.log("--------------------------------------");
  console.log("limitsResponse:", limitsResponse);
  console.log("--------------------------------------");

  const { requestsExceeded } = limitsResponse;

  if (requestsExceeded) {
    await sleep(2);
  }

  await trackRequest();
}

async function handleRequestExceeded() {
  console.log("-------------------------------");
  console.log("In handleRequest exceeded");
  const geminiRequestsCountKey = getGeminiRequestsThisMinuteRedisKey();
  await redis.set(geminiRequestsCountKey, 16);
  const limitsResponse = await checkLimits();
  console.log("limitsResponse:", limitsResponse);
  console.log("-------------------------------");
}

export async function generateTitleAndSummaries(
  transcriptBatch: { id: string; transcript: string }[]
) {
  for (let i = 0; i < 100; i++) {
    try {
      const contents = `Here is the array of transcript objects:\n${JSON.stringify(
        transcriptBatch
      )}`;
      await handleRateLimit();

      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          temperature: 0.3,
          systemInstruction: generateTitleAndSummarySystemPrompt,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
              },
              required: ["id", "title", "summary"],
              propertyOrdering: ["id", "title", "summary"],
            },
          },
        },
      });

      if (!response || !response.text) {
        throw new Error("Invalid batch title and summary response format");
      }

      const result = JSON.parse(response.text);

      if (!isValidBatchTitleAndSummaryResponse(result, transcriptBatch)) {
        throw new Error("Invalid batch title and summary response format");
      }

      return result;
    } catch (error) {
      if (error instanceof Error) {
        console.log("error.stack is ", error.stack);
        console.log("error.message is ", error.message);
      }

      if (
        error instanceof Error &&
        error.message.includes("GoogleGenerativeAI Error")
      ) {
        console.log(
          `Trying again for ${i + 1} time --generateTitleAndSummaries`
        );
        await handleRequestExceeded();
        sleep(i + 1);
        continue;
      }

      if (
        error instanceof Error &&
        error.message.includes("429 Too Many Requests")
      ) {
        console.log(
          `Trying again for ${i + 1} time --generateTitleAndSummaries`
        );
        await handleRequestExceeded();
        sleep(i + 1);
        continue;
      }

      if (
        error instanceof Error &&
        (error.message.includes(
          "Invalid batch title and summary response format"
        ) ||
          error.stack?.includes("SyntaxError"))
      ) {
        console.log("--------------------------------");
        console.log(`Syntax Error occurred. Trying again for ${i} time`);
        console.log("--------------------------------");
        sleep(i + 1);
        continue;
      }

      throw new Error(
        error instanceof Error
          ? error.message
          : "Could Not generate title and summaries, unexpected error occurred."
      );
    }
  }
  throw new Error(
    "Could Not generate title and summaries, unexpected error occurred."
  );
}

export async function generateVideoOverview(videoId: string) {
  for (let i = 0; i < 100; i++) {
    try {
      const blogs = await prisma.blog.findMany({
        where: {
          videoId,
          summary: { not: null },
        },
        select: {
          id: true,
          summary: true,
        },
      });

      if (blogs.length === 0) {
        throw new Error(`No summaries found for videoId: ${videoId}`);
      }

      console.log(`Found ${blogs.length} summaries for videoId: ${videoId}`);

      const summariesText = blogs
        .map((blog) => `Summary (ID: ${blog.id}): ${blog.summary}`)
        .join("\n\n");

      const contents = `Here are the summaries:\n${summariesText}`;

      await handleRateLimit();

      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          temperature: 0.3,
          systemInstruction: generateVideoOverviewSystemPrompt,
          responseMimeType: "text/plain",
        },
      });

      if (!response || !response.text) {
        throw new Error("GoogleGenerativeAI Error :No response from model");
      }

      const overview = response.text.trim();
      console.log(`Generated overview for videoId: ${videoId}:`, overview);

      return overview;
    } catch (error) {
      if (error instanceof Error) {
        console.log("error.stack is ", error.stack);
        console.log("error.message is ", error.message);
      }

      if (
        error instanceof Error &&
        error.message.includes("GoogleGenerativeAI Error")
      ) {
        console.log(`Trying again for ${i + 1} time --generateVideoOverview`);
        await handleRequestExceeded();
        sleep(i + 1);
        continue;
      }

      if (
        error instanceof Error &&
        error.message.includes("429 Too Many Requests")
      ) {
        console.log(`Trying again for ${i + 1} time --generateVideoOverview`);
        await handleRequestExceeded();
        sleep(i + 1);
        continue;
      }

      throw new Error(
        error instanceof Error
          ? error.message
          : "Could Not generate video overview, unexpected error occurred."
      );
    }
  }

  throw new Error(
    "Could Not generate video overview, unexpected error occurred."
  );
}

export async function generateBlogContent(
  overview: string,
  allSummaries: string,
  transcript: string
) {
  for (let i = 0; i < 100; i++) {
    try {
      const contents = `
      Video Overview:
      ${overview}

      All Blog Summaries (Context):
      ${allSummaries}

      Transcript to Explain:
      ${transcript}
      `;

      await handleRateLimit();

      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          temperature: 0.5,
          systemInstruction: generateBlogContentSystemPrompt,
          responseMimeType: "text/plain",
        },
      });

      if (!response || !response.text) {
        throw new Error("GoogleGenerativeAI Error : No response from model");
      }

      const blog = response.text.trim();

      return blog;
    } catch (error) {
      if (error instanceof Error) {
        console.log("error.stack is ", error.stack);
        console.log("error.message is ", error.message);
      }

      if (
        error instanceof Error &&
        error.message.includes("GoogleGenerativeAI Error")
      ) {
        console.log(`Trying again for ${i + 1} time --generateBlogContent`);
        await handleRequestExceeded();
        sleep(i + 1);
        continue;
      }

      throw new Error(
        error instanceof Error
          ? error.message
          : "Could not generate blog content, unexpected error occurred."
      );
    }
  }

  throw new Error(
    "Could not generate blog content, unexpected error occurred."
  );
}

function isValidBatchTitleAndSummaryResponse(
  data: any,
  transcriptBatch: { id: string; transcript: string }[]
) {
  if (!Array.isArray(data)) {
    console.log("Validation failed: Response is not an array.");
    return false;
  }

  for (const item of data) {
    if (typeof item !== "object" || item === null) {
      console.log("Validation failed: Item is not an object or is null:", item);
      return false;
    }

    if (
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      typeof item.summary !== "string"
    ) {
      console.log(
        "Validation failed: Missing or invalid types for keys in:",
        item
      );
      return false;
    }

    if (!item.title.trim() || !item.summary.trim()) {
      console.log("Validation failed: Empty title or summary in:", item);
      return false;
    }

    if (Object.keys(item).length !== 3) {
      console.log("Validation failed: Unexpected keys in:", item);
      return false;
    }

    const originalItem = transcriptBatch.find((t) => t.id === item.id);
    if (!originalItem) {
      console.log(
        "Validation failed: ID not found in original transcriptBatch:",
        item.id
      );
      return false;
    }
  }

  return true;
}
