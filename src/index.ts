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

app.listen(PORT, () => {
  console.log(`Server is listening on http://localhost:${PORT}`);
});
