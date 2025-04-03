import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
if (!YOUTUBE_API_KEY) {
  throw new Error("YOUTUBE_API_KEY is required.");
}

export async function fetchYouTubeTranscript() {
  try {
    const youtube = google.youtube({
      version: "v3",
      auth: YOUTUBE_API_KEY,
    });

    // Step 1: Get the caption tracks available for the video
    const captionResponse = await fetch(
      `https://youtube.googleapis.com/youtube/v3/captions?part=snippet&videoId=M7FIvfx5J10&key=${YOUTUBE_API_KEY}`
    );

    console.log("captionResponse is ", captionResponse);

    const captionData = await captionResponse.json();

    console.log("captionData is ", captionData);

    const parsedSnippet = captionData.items.map((item: any) => item.snippet);

    console.log("parsedSnippet is ", parsedSnippet);

    // Check if captions exist
    if (!captionData.items || captionData.items.length === 0) {
      throw new Error("No captions found for this video");
    }

    // Prefer English captions if available, otherwise use the first available
    let captionId = captionData.items[0].id;
    const englishCaption = captionData.items.find(
      (caption: any) => caption.snippet.language === "en"
    );

    if (englishCaption) {
      captionId = englishCaption.id;
    }

    // Step 2: Download the caption track
    const captionTrack = await youtube.captions.download({
      id: captionId,
    });

    // Parse the caption data (this will depend on the format, typically SRT or WebVTT)
    // const parsedTranscript = parseCaptionData(captionTrack.data);

    return captionTrack;
  } catch (error) {
    console.error("Error fetching YouTube transcript:", error);
    throw error;
  }
}
