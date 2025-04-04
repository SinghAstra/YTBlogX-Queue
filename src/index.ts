import express, { Request, Response } from "express";

import cleanRoutes from "./routes/clean";
import queueRoutes from "./routes/queue";

const app = express();
const PORT = 5000;

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Service is up and running.",
  });
});
app.use("/api/queue", queueRoutes);
app.use("/api/clean", cleanRoutes);
app.get("/data", async (_req: Request, res: Response): Promise<any> => {
  try {
    const videoUrl = "https://www.youtube.com/watch?v=ZBi8Qa9m5c0";
    const response = await fetch(videoUrl);
    const data = await response.text();

    const pattern = /ytInitialPlayerResponse\s*=\s*({.+?});/;
    const match = data.match(pattern);

    if (!match || !match[1]) {
      return res
        .status(400)
        .json({ message: "ytInitialPlayerResponse not found" });
    }

    const playerResponse = JSON.parse(match[1]);

    // 1. Get caption tracks
    const tracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!tracks || tracks.length === 0) {
      return res.status(404).json({ message: "No captions found" });
    }

    // 2. Find the English ASR track
    const transcriptTrack = tracks.find((t: any) => t.languageCode === "en");

    if (!transcriptTrack) {
      return res.status(404).json({ message: "English transcript not found" });
    }

    const transcriptUrl = transcriptTrack.baseUrl + "&fmt=json3";

    // 3. Fetch the transcript
    const transcriptRes = await fetch(transcriptUrl);
    const transcriptJson = await transcriptRes.json();

    // 4. Extract text lines
    const lines: string[] = [];
    for (const event of transcriptJson.events || []) {
      if (event.segs) {
        const text = event.segs.map((seg: any) => seg.utf8).join("");
        if (text.trim() === "") continue;
        lines.push(text.trim());
      }
    }

    res.json({
      videoId: transcriptTrack.videoId,
      language: transcriptTrack.languageCode,
      transcript: lines,
    });
  } catch (error) {
    if (error instanceof Error) {
      console.log("error.stack is ", error.stack);
      console.log("error.message is ", error.message);
    }
    res.status(500).json({ message: "Internal Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is listening on http://localhost:${PORT}`);
});
