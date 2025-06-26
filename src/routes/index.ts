import express from "express";
import appRoutes from "./appRoutes.js";
const router = express.Router();

// API info endpoint
router.get("/", (req, res) => {
  res.json({
    message: "CDP Hackathon Backend API",
    version: "1.0.0",
    endpoints: {
      health: "/health",
      users: "/api/users",
      account: "/api/getAccount",
      chat: "/api/chat",
      topup: "/api/topup",
      addTool: "/api/addTool",
      addMedia: "/api/addMedia",
    },
  });
});

// Health check with detailed info
router.get("/health/detailed", (_, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version,
  });
});

// Mount routes
router.use("/", appRoutes);

export default router;
