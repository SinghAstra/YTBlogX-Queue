import express from "express";
import { fetchYouTubeTranscript } from "./lib/youtube";
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
app.get("/fetch-transcript", async (req, res) => {
  console.log("In /fetch-transcript");
  const captionTrack = await fetchYouTubeTranscript();
  res.json({
    captionTrack,
  });
});

app.listen(PORT, () => {
  console.log(`Server is listening on http://localhost:${PORT}`);
});
