import { Request, Response, Router } from "express";
import { videoQueueController } from "../controllers/video.js";
import { verifyServiceToken } from "../middleware/verify-service-token.js";

const router = Router();

router.post("/video", verifyServiceToken, videoQueueController);

export default router;
