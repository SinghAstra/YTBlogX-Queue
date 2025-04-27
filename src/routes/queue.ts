import { Request, Response, Router } from "express";
import { addToVideoQueue } from "../controllers/queue.js";
import { verifyServiceToken } from "../middleware/verify-service-token.js";

const router = Router();

router.post("/video", verifyServiceToken, addToVideoQueue);

export default router;
