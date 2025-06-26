import { Router } from "express";
import { AppController } from "../controllers/AppController.js";
import { firebaseAuth } from "../middleware/firebaseAuth.js";
import { generalLimiter } from "../middleware/rateLimiter.js";

const router = Router();
const appController = new AppController();

// Apply Firebase authentication to all routes
router.use(firebaseAuth);

// Apply rate limiting
router.use(generalLimiter);

// GET /getAccount - Get user account information
router.get("/user/getAccount", appController.getAccount);

// POST /chat - Send chat message and get AI response
router.post("/user/chat", appController.chat);

// POST /topup - Top up user account balance
router.post("/user/topup", appController.topup);

// POST /addTool - Add a new tool for the user
router.post("/user/addTool", appController.addTool);

// POST /addMedia - Add media file for the user
router.post("/user/addMedia", appController.addMedia);

export default router;
