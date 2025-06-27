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

router.get("/chat/history", appController.getChatHistory);

// POST /topup - Top up user account balance
router.post("/user/topup", appController.topup);

// POST /addTool - Add a new tool for the user
router.post("/user/addTool", appController.addTool);

router.get("/user/tools/search", appController.searchTools); // Search tools globally
router.get("/user/tools/categories", appController.getToolCategories); // Get categories
router.get("/user/tools/popular", appController.getPopularTools); // Get popular tools
router.post("/user/tools/execute", appController.executeTool); // Execute tool
router.get("/tools/recommend", appController.getToolRecommendations); // AI-powered recommendations
// POST /addMedia - Add media file for the user
router.get("/user/tools/usage", appController.getToolUsageAnalytics); // Get usage analytics
router.get("/user/tools/revenue", appController.getToolRevenue); // Get revenue breakdown
router.get("/user/tools/performance", appController.getToolPerformance); // Get performance metrics
router.post("/user/addMedia", appController.addMedia);
router.post("/user/tools/external-execute", appController.executeExternalTool); // Execute external paid API

export default router;
