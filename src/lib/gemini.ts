import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "./prisma";
import redis from "./redis";
import {
  getGeminiRequestsThisMinuteRedisKey,
  getGeminiTokensConsumedThisMinuteRedisKey,
} from "./redis-keys";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required.");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const REQUEST_LIMIT = 15;
const TOKEN_LIMIT = 800000;

export async function trackRequest(tokenCount: number) {
  const geminiRequestsCountKey = getGeminiRequestsThisMinuteRedisKey();
  const geminiRequestsTokenConsumedKey =
    getGeminiTokensConsumedThisMinuteRedisKey();

  const result = await redis
    .multi()
    .incr(geminiRequestsCountKey)
    .incrby(geminiRequestsTokenConsumedKey, tokenCount)
    .expire(geminiRequestsCountKey, 60)
    .expire(geminiRequestsTokenConsumedKey, 60)
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
  const geminiRequestsTokenConsumedKey =
    getGeminiTokensConsumedThisMinuteRedisKey();

  const [requests, tokens] = await redis.mget(
    geminiRequestsCountKey,
    geminiRequestsTokenConsumedKey
  );

  return {
    requests: parseInt(requests ?? "0"),
    tokens: parseInt(tokens ?? "0"),
    requestsExceeded: parseInt(requests ?? "0") >= REQUEST_LIMIT,
    tokensExceeded: parseInt(tokens ?? "0") >= TOKEN_LIMIT,
  };
}

async function sleep() {
  console.log(`Rate limit exceeded. Waiting for 1500ms...`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

export async function estimateTokenCount(
  prompt: string,
  maxOutputTokens = 1000
) {
  return Math.ceil(prompt.length / 4) + maxOutputTokens;
}

export async function handleRateLimit(tokenCount: number) {
  const limitsResponse = await checkLimits();

  console.log("--------------------------------------");
  console.log("limitsResponse:", limitsResponse);
  console.log("--------------------------------------");

  const { requestsExceeded, tokensExceeded } = limitsResponse;

  if (requestsExceeded || tokensExceeded) {
    await sleep();
  }

  await trackRequest(tokenCount);
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
  for (let i = 0; i < 10; i++) {
    try {
      const prompt = `
      You are a concise summarizer and title generator for YouTube video transcripts. 
      I will provide you with an array of objects, each containing an 'id' and a 'transcript' from a YouTube video.
      
      For each object in the array, generate:
      - A short, engaging title (maximum 10 words).
      - A concise summary (20-40 words) capturing the key points of the transcript.
      
      Return your response as a JSON array of objects, where each object contains the following properties:
      - 'id': The original ID from the input object.
      - 'title': The generated title as a string.
      - 'summary': The generated summary as a string.
      
      Ensure that all keys and values are strings and that the entire JSON is valid for direct parsing with JSON.parse(). 
      Do not include any additional text, explanations, or comments outside the JSON array. The response should consist solely of the JSON array.
      
      For example, if the input is:
      [{"id":"123","transcript":"This is an introduction to AI..."},{"id":"456","transcript":"Here we discuss the challenges in AI..."}]
      
      Your response should be:
      [{"id":"123","title":"Introduction to Artificial Intelligence","summary":"This section provides an overview of AI, its definition, and significance in modern technology."},{"id":"456","title":"Challenges in AI Development","summary":"It explores the primary obstacles faced by AI researchers, including data quality and ethical concerns."}]
      
      Here is the array of transcript objects:
      ${JSON.stringify(transcriptBatch)}
      `;

      const tokenCount = await estimateTokenCount(prompt);

      await handleRateLimit(tokenCount);

      const result = await model.generateContent(prompt);
      let rawResponse = result.response.text();

      console.log("rawResponse is ", rawResponse);

      // Remove potential Markdown or extra text
      rawResponse = rawResponse
        .replace(/```json/g, "") // Remove ```json
        .replace(/```/g, "") // Remove ```
        .trim(); // Remove leading/trailing whitespace

      const parsedResponse = JSON.parse(rawResponse);
      console.log("parsedResponse is ", parsedResponse);

      if (
        !isValidBatchTitleAndSummaryResponse(parsedResponse, transcriptBatch)
      ) {
        throw new Error("Invalid batch title and summary response format");
      }

      return parsedResponse;
    } catch (error) {
      if (error instanceof Error) {
        console.log("error.stack is ", error.stack);
        console.log("error.message is ", error.message);
      }

      if (
        error instanceof Error &&
        error.message.includes("429 Too Many Requests")
      ) {
        await handleRequestExceeded();
        sleep();
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

// Function to generate a video overview based on summaries
export async function generateVideoOverview(videoId: string) {
  for (let i = 0; i < 10; i++) {
    try {
      // Fetch all blog summaries for the given videoId
      const blogs = await prisma.blog.findMany({
        where: {
          videoId,
          summary: { not: null }, // Ensure we only get blogs with summaries
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

      // Prepare the summaries as a single string for the prompt
      const summariesText = blogs
        .map((blog) => `Summary (ID: ${blog.id}): ${blog.summary}`)
        .join("\n\n");

      // Construct the prompt for Gemini
      const prompt = `
      You are an expert summarizer. Below is a collection of summaries from different parts of a video.
      Your task is to generate a concise, cohesive overview of the entire video in 4-6 sentences.
      Focus on capturing the main themes, key points, and overall purpose of the video based on these summaries.
      Return only the plain text overview, with no additional formatting, labels, or explanations.

      Summaries:
      ${summariesText}
    `;

      const tokenCount = await estimateTokenCount(prompt);

      await handleRateLimit(tokenCount);

      // Generate the overview using Gemini API
      const result = await model.generateContent(prompt);
      const overview = result.response.text().trim();

      console.log(`Generated overview for videoId: ${videoId}:`, overview);

      return overview;
    } catch (error) {
      if (error instanceof Error) {
        console.log("error.stack is ", error.stack);
        console.log("error.message is ", error.message);
      }

      if (
        error instanceof Error &&
        error.message.includes("429 Too Many Requests")
      ) {
        await handleRequestExceeded();
        sleep();
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
  for (let i = 0; i < 10; i++) {
    try {
      const prompt = `
      You are a professional blog writer. Using the provided video overview, 
      a collection of all blog summaries for context, and the specific transcript,
      generate a well-structured, context-aware blog post content in markdown format.
      Write in a friendly and engaging tone suitable for beginners.
      If the transcript is incomplete, infer the intent or note that the explanation continues in the next part.

      The content should be engaging, informative, detailed and 
      should reference relevant context from other summaries when appropriate.
      
      Video Overview: ${overview}
      All blog Summaries (for context): ${allSummaries}
      Specific Transcript (focus of this blog): ${transcript}
      
      Return only the markdown content with no additional text or explanations.
    `;

      const tokenCount = await estimateTokenCount(prompt);

      await handleRateLimit(tokenCount);

      const result = await model.generateContent(prompt);
      const blogContent = result.response.text().trim();

      return blogContent;
    } catch (error) {
      if (error instanceof Error) {
        console.log("error.stack is ", error.stack);
        console.log("error.message is ", error.message);
      }

      if (
        error instanceof Error &&
        error.message.includes("429 Too Many Requests")
      ) {
        await handleRequestExceeded();
        sleep();
        continue;
      }
      throw new Error(
        error instanceof Error
          ? error.message
          : "Could Not generate blog content, unexpected error occurred."
      );
    }
  }
  throw new Error(
    "Could Not generate blog content, unexpected error occurred."
  );
}

function isValidBatchTitleAndSummaryResponse(
  data: any,
  transcriptBatch: { id: string; transcript: string }[]
) {
  if (!Array.isArray(data) || transcriptBatch.length !== data.length) {
    return false;
  }

  // Validate each item in the array
  for (const item of data) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      typeof item.summary !== "string" ||
      !item.title.trim() ||
      !item.summary.trim() ||
      Object.keys(item).length !== 3
    ) {
      return false;
    }
  }

  return true;
}
