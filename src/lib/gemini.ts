import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "./prisma";

const geminiKey = process.env.GEMINI_API_KEY;
if (!geminiKey) {
  throw new Error("GEMINI_API_KEY is required.");
}

const genAI = new GoogleGenerativeAI(geminiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// Token consumption tracking
let tokenConsumed = 0;
const TOKEN_LIMIT = 800000;

// Sleep function for rate limiting
const sleep = () => new Promise((resolve) => setTimeout(resolve, 1000));

export async function generateTitleAndSummaries(
  transcriptBatch: { id: string; transcript: string }[]
) {
  for (let i = 0; i < 5; i++) {
    try {
      // Check token consumption and wait if necessary
      if (tokenConsumed >= TOKEN_LIMIT) {
        console.log(
          `Token limit reached (${tokenConsumed}). Cooling down for 1000ms`
        );
        await sleep();
        tokenConsumed = 0;
      }

      // Estimate token consumption for this batch (rough estimate)
      // Assuming approximately 1 token per 4 characters
      const estimatedTokens = transcriptBatch.reduce(
        (total, blog) => total + Math.ceil(blog.transcript.length / 4),
        0
      );
      tokenConsumed += estimatedTokens;
      console.log("tokenConsumed: ", tokenConsumed);

      const prompt = `
      You are a concise summarizer and title generator. 
      I will provide you with an array of transcript from a YouTube video. 
      
      For each segment:
      - Generate a short, engaging title (max 10 words).
      - Provide a 2-4 line summary capturing the key points.
      
      Return your response as a JSON array of objects, ensuring:
      - Each object contains 'id', 'title', and 'summary' properties.
      - All keys and values are strings — the entire JSON must be valid for direct parsing with JSON.parse().

      Format your entire response as valid JSON with no additional text before or after.

      Example:
      [{"id":"123","title":"Introduction to AI","summary":"This section explains what AI is and its importance."},
       {"id":"456","title":"Key Challenges in AI","summary":"It discusses the main challenges AI researchers face."}]
      
      Here are the transcript :
      ${JSON.stringify(transcriptBatch)}
    `;

      const result = await model.generateContent(prompt);
      let responseText = result.response.text();
      console.log("Raw responseText:", responseText); // Log raw response for debugging

      // Remove potential Markdown or extra text
      responseText = responseText
        .replace(/```json/g, "") // Remove ```json
        .replace(/```/g, "") // Remove ```
        .trim(); // Remove leading/trailing whitespace

      console.log("Cleaned responseText:", responseText); // Log cleaned response
      console.log("typeof responseText is ", typeof responseText);

      const titlesAndSummaries = JSON.parse(responseText);

      // Validate that we got an array of objects with id and summary
      if (!Array.isArray(titlesAndSummaries)) {
        throw new Error("Response is not an array");
      }

      console.log("titlesAndSummaries is ", titlesAndSummaries);

      return titlesAndSummaries;
    } catch (error) {
      if (error instanceof Error) {
        console.log("error.stack is ", error.stack);
        console.log("error.message is ", error.message);
      }
      if (
        error instanceof Error &&
        error.message.includes("Expected double-quoted property name in JSON")
      ) {
        console.log("--------------------------------");
        console.log(`Syntax Error occurred. Trying again for ${i} time`);
        console.log("--------------------------------");
        continue;
      } else {
        console.log("--------------------------------");
        console.log(`Non Syntax Error occurred.Aborting --generateSummaries`);
        console.log("--------------------------------");
        return [];
      }
    }
  }
}

// Function to generate a video overview based on summaries
export async function generateVideoOverview(videoId: string) {
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

    // Check token consumption and wait if necessary
    if (tokenConsumed >= TOKEN_LIMIT) {
      console.log(
        `Token limit reached (${tokenConsumed}). Cooling down for 1000ms`
      );
      await sleep();
      tokenConsumed = 0;
    }

    // Estimate token consumption for this batch (rough estimate)
    // Assuming approximately 1 token per 4 characters
    const estimatedTokens = prompt.length / 4;
    tokenConsumed += estimatedTokens;

    console.log("tokenConsumed: ", tokenConsumed);

    // Generate the overview using Gemini API
    const result = await model.generateContent(prompt);
    const overview = result.response.text().trim();

    console.log(`Generated overview for videoId: ${videoId}:`, overview);

    return overview;
  } catch (error) {
    if (error instanceof Error) {
      console.error("error.stack is ", error.stack);
      console.error("error.message is ", error.message);
    }
    throw error;
  }
}

export async function generateBlogContent(
  overview: string,
  allSummaries: string,
  transcript: string
) {
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

    // Check token consumption and wait if necessary
    if (tokenConsumed >= TOKEN_LIMIT) {
      console.log(
        `Token limit reached (${tokenConsumed}). Cooling down for 1000ms`
      );
      await sleep();
      tokenConsumed = 0;
    }

    // Estimate token consumption for this batch (rough estimate)
    // Assuming approximately 1 token per 4 characters
    const estimatedTokens = prompt.length / 4;
    tokenConsumed += estimatedTokens;

    console.log("tokenConsumed: ", tokenConsumed);
    const result = await model.generateContent(prompt);
    const blogContent = result.response.text().trim();
    console.log(`Generated blog content :`, blogContent);
    return blogContent;
  } catch (error) {
    if (error instanceof Error) {
      console.log("error.stack is ", error.stack);
      console.log("error.message is ", error.message);
    }
    throw error;
  }
}
