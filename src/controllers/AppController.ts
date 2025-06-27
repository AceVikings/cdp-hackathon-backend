import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/firebaseAuth.js";
import { createFacilitatorConfig } from "@coinbase/x402";
import { ApiResponse } from "../types/api.js";
import { exact } from "x402/schemes";
import { toAccount } from "viem/accounts";
import { formatEther } from "viem";
import {
  Network,
  PaymentPayload,
  PaymentRequirements,
  Price,
  Resource,
  settleResponseHeader,
  Wallet,
} from "x402/types";
import { useFacilitator } from "x402/verify";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import { processPriceToAtomicAmount } from "x402/shared";
import {
  Account,
  ChatRequest,
  ChatMessage,
  TopupRequest,
  TopupResponse,
  AddToolRequest,
  Tool,
  AddMediaRequest,
  Media,
} from "../types/app.js";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
} from "@langchain/core/messages";
import { CdpClient } from "@coinbase/cdp-sdk";
import { asyncHandler } from "../utils/asyncHandler.js";
import { generateId } from "../utils/helpers.js";
import { config } from "../config/index.js";
import { ChatOpenAI } from "@langchain/openai";
import { ChatHistoryService } from "../services/chatHistory.js";
import {
  ToolDiscoveryService,
  ToolSearchFilters,
} from "../services/toolDiscovery.js";
import { ToolExecutorService } from "../services/toolExecution.js";
import { ApiTool, IApiTool } from "../models/apiTool.js";
import { EthUtils } from "../utils/ethUtils.js";
import { ToolUsage } from "../models/toolUsage.js";
const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
  apiKey: process.env.OPENAI_API_KEY,
  verbose: true,
});
const facilitator = createFacilitatorConfig(
  config.cdp.apiKeyId,
  config.cdp.apiKeySecret
);
const { settle, verify } = useFacilitator({
  url: facilitator.url,
});
function createExactPaymentRequirements(
  price: Price,
  network: Network,
  resource: Resource,
  description = "",
  payTo: string
): PaymentRequirements {
  const atomicAmountForAsset = processPriceToAtomicAmount(price, network);
  if ("error" in atomicAmountForAsset) {
    throw new Error(atomicAmountForAsset.error);
  }
  const { maxAmountRequired, asset } = atomicAmountForAsset;

  return {
    scheme: "exact",
    network,
    maxAmountRequired,
    resource,
    description,
    mimeType: "",
    payTo: payTo,
    maxTimeoutSeconds: 60,
    asset: asset.address,
    outputSchema: undefined,
    extra: {
      name: asset.eip712.name,
      version: asset.eip712.version,
    },
  };
}

async function verifyPayment(
  req: AuthenticatedRequest,
  res: Response,
  paymentRequirements: PaymentRequirements[]
): Promise<boolean> {
  const payment = req.header("X-PAYMENT");
  const x402Version = 1;
  if (!payment) {
    res.status(402).json({
      x402Version: 1,
      error: "X-PAYMENT header is required",
      accepts: paymentRequirements,
    });
    return false;
  }

  let decodedPayment: PaymentPayload;
  try {
    decodedPayment = exact.evm.decodePayment(payment);
    decodedPayment.x402Version = x402Version;
  } catch (error) {
    res.status(402).json({
      x402Version,
      error: error || "Invalid or malformed payment header",
      accepts: paymentRequirements,
    });
    return false;
  }

  try {
    const response = await verify(decodedPayment, paymentRequirements[0]);
    if (!response.isValid) {
      res.status(402).json({
        x402Version,
        error: response.invalidReason,
        accepts: paymentRequirements,
        payer: response.payer,
      });
      return false;
    }
  } catch (error) {
    res.status(402).json({
      x402Version,
      error,
      accepts: paymentRequirements,
    });
    return false;
  }

  return true;
}

export class AppController {
  // Mock data storage (in production, this would be a database)
  private accounts = new Map<string, Account>();
  private chatHistoryService: ChatHistoryService;
  private toolDiscoveryService: ToolDiscoveryService;
  private toolExecutorService: ToolExecutorService;
  private tools = new Map<string, Tool[]>();
  private media = new Map<string, Media[]>();
  private cdp: CdpClient;
  constructor() {
    // Initialize with some mock data
    this.initializeMockData();
    this.cdp = new CdpClient({
      apiKeyId: config.cdp.apiKeyId,
      apiKeySecret: config.cdp.apiKeySecret,
      walletSecret: config.cdp.walletSecret,
    });
    this.chatHistoryService = new ChatHistoryService();
    this.toolDiscoveryService = new ToolDiscoveryService();
    this.toolExecutorService = new ToolExecutorService();
  }

  private initializeMockData(): void {
    // Mock account for testing
    const mockAccount: Account = {
      id: "acc-1",
      userId: "test-user",
      balance: 1000.5,
      currency: "USD",
      walletAddress: "0x1234567890abcdef",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.accounts.set("test-user", mockAccount);
  }

  // GET /getAccount
  getAccount = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.uid;

      if (!userId) {
        const response: ApiResponse = {
          success: false,
          message: "User ID not found in token",
        };
        res.status(400).json(response);
        return;
      }

      let account = await this.cdp.evm.getOrCreateAccount({
        name: userId,
      });

      // Create account if it doesn't exist

      const response: ApiResponse = {
        success: true,
        message: "Account retrieved successfully",
        data: account.address,
      };

      res.status(200).json(response);
    }
  );

  chat = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.uid;
    const { message, context }: ChatRequest = req.body;

    if (!userId) {
      const response: ApiResponse = {
        success: false,
        message: "User ID not found in token",
      };
      res.status(400).json(response);
      return;
    }

    if (!message || message.trim() === "") {
      const response: ApiResponse = {
        success: false,
        message: "Message is required",
      };
      res.status(400).json(response);
      return;
    }

    try {
      // Get existing chat history from MongoDB
      const existingHistory = await this.chatHistoryService.getRecentMessages(
        userId,
        2
      );

      // Check if user is looking for tools
      const toolSearchResult = await this.checkForToolSearch(message.trim());

      let toolsContext = "";
      let foundTools: any[] = [];

      if (toolSearchResult.isToolSearch) {
        // Search for relevant tools
        foundTools = await this.searchRelevantTools(
          toolSearchResult.searchQuery,
          toolSearchResult.category,
          toolSearchResult.maxCost
        );

        if (foundTools.length > 0) {
          toolsContext = this.formatToolsForLLM(foundTools);
        }
      }
      console.log("Tool search result:", toolsContext);
      // Build message history for LLM with enhanced system prompt
      const messages = [
        new SystemMessage(
          `You are a helpful AI assistant for a CDP hackathon application. You can help users with their blockchain accounts, transactions, and general questions.

When users ask about tools or APIs, you have access to a marketplace of tools. If relevant tools are found, provide detailed information about them including:
- Tool name and description
- Category and pricing (in ETH)
- Required parameters
- How to use the tool

${toolsContext ? `\n\nRelevant tools found:\n${toolsContext}` : ""}

Be conversational and helpful. If tools are available, explain how they can be used and their costs.`
        ),
      ];

      // Add previous conversation context
      for (const historyItem of existingHistory) {
        messages.push(new HumanMessage(historyItem.message));
        if (historyItem.response) {
          messages.push(new AIMessage(historyItem.response));
        }
      }

      // Add current message
      messages.push(new HumanMessage(message.trim()));

      // Get AI response
      const aiResponse = await llm.invoke(messages);
      const responseText = aiResponse.content as string;

      const chatMessage: ChatMessage = {
        id: generateId(),
        userId,
        message: message.trim(),
        response: responseText,
        timestamp: new Date(),
      };

      // Save chat message to MongoDB
      await this.chatHistoryService.saveChatMessage(chatMessage);

      const response: ApiResponse = {
        success: true,
        message: "Chat message processed successfully",
        data: {
          id: chatMessage.id,
          response: responseText,
          timestamp: chatMessage.timestamp,
          toolsFound: foundTools.length > 0 ? foundTools : undefined,
          toolSearchPerformed: toolSearchResult.isToolSearch,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      console.error("Chat error:", error);
      const response: ApiResponse = {
        success: false,
        message: "Failed to process chat message",
        errors: [error instanceof Error ? error.message : "Unknown error"],
      };
      res.status(500).json(response);
      return;
    }
  });

  // New method to analyze if user is looking for tools
  private async checkForToolSearch(message: string): Promise<{
    isToolSearch: boolean;
    searchQuery: string;
    category?: string;
    maxCost?: number;
  }> {
    // Create a specialized LLM instance for tool search detection
    const toolDetectionLLM = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
    });

    const detectionPrompt = `Analyze this user message and determine if they are looking for tools, APIs, or services.

User message: "${message}"

Respond with a JSON object containing:
{
  "isToolSearch": boolean,
  "searchQuery": "extracted search terms for finding relevant tools",
  "category": "tool category if mentioned (e.g., 'weather', 'utility', 'finance')",
  "maxCost": number (if user mentions price/cost preferences in ETH)
}

Examples:
- "I need a weather API" -> {"isToolSearch": true, "searchQuery": "weather API", "category": "weather"}
- "Find me tools for sending emails" -> {"isToolSearch": true, "searchQuery": "email tools", "category": "communication"}
- "What's the weather like?" -> {"isToolSearch": false, "searchQuery": ""}
- "Show me cheap APIs under 0.01 ETH" -> {"isToolSearch": true, "searchQuery": "APIs", "maxCost": 0.01}
- "Hello how are you?" -> {"isToolSearch": false, "searchQuery": ""}

Only return the JSON object, no other text.`;

    try {
      const detectionResponse = await toolDetectionLLM.invoke([
        new SystemMessage(
          "You are a tool search detector. Always respond with valid JSON only."
        ),
        new HumanMessage(detectionPrompt),
      ]);

      const result = JSON.parse(detectionResponse.content as string);

      return {
        isToolSearch: result.isToolSearch || false,
        searchQuery: result.searchQuery || "",
        category: result.category,
        maxCost: result.maxCost,
      };
    } catch (error) {
      console.error("Tool detection error:", error);
      // Fallback: simple keyword detection
      const toolKeywords = [
        "api",
        "tool",
        "service",
        "function",
        "weather",
        "email",
        "sms",
        "payment",
        "data",
        "search",
        "translate",
        "image",
        "text",
        "ai",
        "find me",
        "i need",
        "looking for",
        "help me with",
      ];

      const messageLC = message.toLowerCase();
      const hasToolKeywords = toolKeywords.some((keyword) =>
        messageLC.includes(keyword)
      );

      return {
        isToolSearch: hasToolKeywords,
        searchQuery: hasToolKeywords ? message : "",
        category: undefined,
        maxCost: undefined,
      };
    }
  }

  // New method to search for relevant tools
  private async searchRelevantTools(
    searchQuery: string,
    category?: string,
    maxCost?: number
  ): Promise<any[]> {
    try {
      if (!searchQuery || searchQuery.trim() === "") {
        return [];
      }

      const filters: ToolSearchFilters = {};

      if (category) filters.category = category;
      if (maxCost) {
        filters.maxCost = parseInt(EthUtils.ethToWei(maxCost.toString()));
      }

      const tools = await this.toolDiscoveryService.searchToolsGlobally(
        searchQuery,
        filters,
        2 // Limit to top 5 most relevant tools
      );

      return tools.map((tool) => ({
        toolId: tool.toolId,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        pricing: {
          costInWei: tool.pricing.costInWei,
          ethCost:
            tool.pricing.ethCost ||
            EthUtils.weiToEthString(tool.pricing.costInWei),
          formatted: EthUtils.formatWei(tool.pricing.costInWei),
        },
        parameters: tool.parameters.map((p) => ({
          name: p.name,
          type: p.type,
          required: p.required,
          description: p.description,
        })),
        metadata: {
          tags: tool.metadata.tags,
          version: tool.metadata.version,
        },
      }));
    } catch (error) {
      console.error("Error searching relevant tools:", error);
      return [];
    }
  }

  // New method to format tools for LLM context
  private formatToolsForLLM(tools: any[]): string {
    return tools
      .map((tool, index) => {
        const params = tool.parameters
          .map(
            (p: any) =>
              `- ${p.name} (${p.type}${
                p.required ? ", required" : ", optional"
              }): ${p.description}`
          )
          .join("\n");

        return `Tool ${index + 1}: ${tool.name}
ID: ${tool.toolId}
Description: ${tool.description}
Category: ${tool.category}
Cost: ${tool.pricing.formatted}
Parameters:
${params}
Tags: ${tool.metadata.tags.join(", ")}`;
      })
      .join("\n\n");
  }

  // GET /tools/recommend - Get AI-powered tool recommendations
  getToolRecommendations = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.uid;
      const { query, limit = 5 } = req.query;

      if (!userId) {
        const response: ApiResponse = {
          success: false,
          message: "User ID not found in token",
        };
        res.status(400).json(response);
        return;
      }

      if (!query || typeof query !== "string") {
        const response: ApiResponse = {
          success: false,
          message: "Query parameter is required",
        };
        res.status(400).json(response);
        return;
      }

      try {
        // Use the same tool search logic
        const toolSearchResult = await this.checkForToolSearch(query);

        let tools: any[] = [];
        let aiRecommendation = "";

        if (toolSearchResult.isToolSearch) {
          tools = await this.searchRelevantTools(
            toolSearchResult.searchQuery,
            toolSearchResult.category,
            toolSearchResult.maxCost
          );

          // Generate AI recommendation
          if (tools.length > 0) {
            const toolsContext = this.formatToolsForLLM(tools);
            const recommendationLLM = new ChatOpenAI({
              model: "gpt-4o-mini",
              temperature: 0.3,
              apiKey: process.env.OPENAI_API_KEY,
            });

            const recommendationPrompt = `Based on the user's request: "${query}"

Here are the available tools:
${toolsContext}

Provide a helpful recommendation about which tool(s) would be best for their needs. Include:
1. Which tool you recommend and why
2. How much it costs
3. Brief usage example
4. Any important considerations

Keep it concise and actionable.`;

            const recommendationResponse = await recommendationLLM.invoke([
              new SystemMessage(
                "You are a helpful tool recommendation assistant."
              ),
              new HumanMessage(recommendationPrompt),
            ]);

            aiRecommendation = recommendationResponse.content as string;
          }
        }

        const response: ApiResponse = {
          success: true,
          message:
            tools.length > 0
              ? "Tool recommendations generated"
              : "No relevant tools found",
          data: {
            query,
            toolsFound: tools.length,
            tools: tools.slice(0, parseInt(limit as string)),
            aiRecommendation,
            isToolSearch: toolSearchResult.isToolSearch,
          },
        };

        res.status(200).json(response);
      } catch (error) {
        console.error("Error generating tool recommendations:", error);
        const response: ApiResponse = {
          success: false,
          message: "Failed to generate tool recommendations",
          errors: [error instanceof Error ? error.message : "Unknown error"],
        };
        res.status(500).json(response);
      }
    }
  );

  getChatHistory = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.uid;
      const limit = parseInt(req.query.limit as string) || 20;

      if (!userId) {
        const response: ApiResponse = {
          success: false,
          message: "User ID not found in token",
        };
        res.status(400).json(response);
        return;
      }

      try {
        const chatHistory = await this.chatHistoryService.getChatHistory(
          userId,
          limit
        );

        const response: ApiResponse = {
          success: true,
          message: "Chat history retrieved successfully",
          data: {
            messages: chatHistory,
            count: chatHistory.length,
          },
        };

        res.status(200).json(response);
      } catch (error) {
        console.error("Error fetching chat history:", error);
        const response: ApiResponse = {
          success: false,
          message: "Failed to fetch chat history",
          errors: [error instanceof Error ? error.message : "Unknown error"],
        };
        res.status(500).json(response);
      }
    }
  );

  // Optional: Add endpoint to clear chat history
  clearChatHistory = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.uid;

      if (!userId) {
        const response: ApiResponse = {
          success: false,
          message: "User ID not found in token",
        };
        res.status(400).json(response);
        return;
      }

      try {
        const deleted = await this.chatHistoryService.deleteChatHistory(userId);

        const response: ApiResponse = {
          success: true,
          message: deleted
            ? "Chat history cleared successfully"
            : "No chat history found",
          data: { deleted },
        };

        res.status(200).json(response);
      } catch (error) {
        console.error("Error clearing chat history:", error);
        const response: ApiResponse = {
          success: false,
          message: "Failed to clear chat history",
          errors: [error instanceof Error ? error.message : "Unknown error"],
        };
        res.status(500).json(response);
      }
    }
  );

  // POST /topup
  topup = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.uid;

    if (!userId) {
      const response: ApiResponse = {
        success: false,
        message: "User ID not found in token",
      };
      res.status(400).json(response);
      return;
    }

    let account = await this.cdp.evm.getOrCreateAccount({
      name: userId,
    });

    const faucetTransaction = await account.requestFaucet({
      network: "base-sepolia",
      token: "eth",
    });

    if (!faucetTransaction) {
      const response: ApiResponse = {
        success: false,
        message: "Failed to initiate topup",
      };
      res.status(500).json(response);
      return;
    }
    const response: ApiResponse = {
      success: true,
      message: "Topup initiated successfully",
      data: faucetTransaction.transactionHash,
    };

    res.status(200).json(response);
  });

  // POST /tools/register - Register a new API tool
  addTool = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.uid;
    const toolData = req.body;

    if (!userId) {
      const response: ApiResponse = {
        success: false,
        message: "User ID not found in token",
      };
      res.status(400).json(response);
      return;
    }

    // Validate required fields for API tool
    const requiredFields = [
      "name",
      "description",
      "category",
      "apiConfig",
      "parameters",
      "responseSchema",
      "pricing",
    ];

    const missingFields = requiredFields.filter((field) => !toolData[field]);

    if (missingFields.length > 0) {
      const response: ApiResponse = {
        success: false,
        message: `Missing required fields: ${missingFields.join(", ")}`,
      };
      res.status(400).json(response);
      return;
    }

    // Validate pricing structure
    if (!toolData.pricing.costInWei) {
      const response: ApiResponse = {
        success: false,
        message: "Pricing must include costInWei",
      };
      res.status(400).json(response);
      return;
    }

    // Validate wei amount
    if (!EthUtils.isValidWei(toolData.pricing.costInWei)) {
      const response: ApiResponse = {
        success: false,
        message: "Invalid wei amount in pricing",
      };
      res.status(400).json(response);
      return;
    }

    // Validate API config
    if (!toolData.apiConfig.endpoint || !toolData.apiConfig.method) {
      const response: ApiResponse = {
        success: false,
        message: "API config must include endpoint and method",
      };
      res.status(400).json(response);
      return;
    }

    // Validate parameters array
    if (!Array.isArray(toolData.parameters)) {
      const response: ApiResponse = {
        success: false,
        message: "Parameters must be an array",
      };
      res.status(400).json(response);
      return;
    }

    try {
      // Add ETH display value if not provided
      if (!toolData.pricing.ethCost) {
        toolData.pricing.ethCost = EthUtils.weiToEthString(
          toolData.pricing.costInWei
        );
      }

      // Set default metadata if not provided
      if (!toolData.metadata) {
        toolData.metadata = {};
      }

      toolData.metadata = {
        isActive: true,
        isPublic: true,
        tags: toolData.metadata.tags || [],
        version: toolData.metadata.version || "1.0.0",
        ...toolData.metadata,
      };

      const tool = await this.toolDiscoveryService.registerApiTool(
        userId,
        toolData
      );

      const response: ApiResponse = {
        success: true,
        message: "API tool registered successfully",
        data: {
          toolId: tool.toolId,
          name: tool.name,
          description: tool.description,
          category: tool.category,
          pricing: tool.pricing,
          metadata: tool.metadata,
          createdAt: tool.createdAt,
        },
      };

      res.status(201).json(response);
    } catch (error) {
      console.error("Tool registration error:", error);
      const response: ApiResponse = {
        success: false,
        message: "Failed to register tool",
        errors: [error instanceof Error ? error.message : "Unknown error"],
      };
      res.status(500).json(response);
    }
  });

  // Add this method to the AppController class

  // GET /user/tools/usage - Get usage analytics for user's tools
  getToolUsageAnalytics = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.uid;
      const {
        toolId,
        timeframe = "30d",
        groupBy = "day",
        includeRevenue = true,
      } = req.query;

      if (!userId) {
        const response: ApiResponse = {
          success: false,
          message: "User ID not found in token",
        };
        res.status(400).json(response);
        return;
      }

      try {
        // Get user's tools first
        const userTools = await ApiTool.find({
          userId,
          "metadata.isActive": true,
        }).select("toolId name pricing");

        if (userTools.length === 0) {
          const response: ApiResponse = {
            success: true,
            message: "No tools found for user",
            data: {
              tools: [],
              totalRevenue: "0",
              totalUsage: 0,
              analytics: [],
            },
          };
          res.status(200).json(response);
          return;
        }

        const toolIds = userTools.map((tool) => tool.toolId);

        // Calculate time range
        const timeRanges = {
          "24h": new Date(Date.now() - 24 * 60 * 60 * 1000),
          "7d": new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          "30d": new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          "90d": new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          "1y": new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        };

        const startDate =
          timeRanges[timeframe as keyof typeof timeRanges] || timeRanges["30d"];

        // Base match criteria
        const matchCriteria: any = {
          toolId: { $in: toolIds },
          timestamp: { $gte: startDate },
        };

        // If specific tool requested
        if (toolId && typeof toolId === "string") {
          matchCriteria.toolId = toolId;
        }

        // Aggregation pipeline for detailed analytics
        const analyticsAggregation = [
          { $match: matchCriteria },
          {
            $group: {
              _id: {
                toolId: "$toolId",
                date: {
                  $dateToString: {
                    format:
                      groupBy === "hour"
                        ? "%Y-%m-%d %H:00"
                        : groupBy === "day"
                        ? "%Y-%m-%d"
                        : groupBy === "week"
                        ? "%Y-W%U"
                        : "%Y-%m",
                    date: "$timestamp",
                  },
                },
              },
              totalExecutions: { $sum: 1 },
              successfulExecutions: {
                $sum: { $cond: ["$response.success", 1, 0] },
              },
              failedExecutions: {
                $sum: { $cond: ["$response.success", 0, 1] },
              },
              paidExecutions: {
                $sum: { $cond: ["$billing.paid", 1, 0] },
              },
              totalRevenue: {
                $sum: {
                  $cond: [
                    "$billing.paid",
                    { $toDouble: "$billing.costInWei" },
                    0,
                  ],
                },
              },
              averageExecutionTime: {
                $avg: "$response.executionTime",
              },
              uniqueUsers: { $addToSet: "$userId" },
            },
          },
          {
            $addFields: {
              successRate: {
                $cond: [
                  { $gt: ["$totalExecutions", 0] },
                  { $divide: ["$successfulExecutions", "$totalExecutions"] },
                  0,
                ],
              },
              uniqueUserCount: { $size: "$uniqueUsers" },
            },
          },
          { $sort: { "_id.date": -1 as 1 | -1, "_id.toolId": 1 as 1 | -1 } },
        ];

        // Overall summary aggregation
        const summaryAggregation = [
          { $match: matchCriteria },
          {
            $group: {
              _id: "$toolId",
              toolName: { $first: "$toolId" }, // Will be replaced with actual name
              totalExecutions: { $sum: 1 },
              successfulExecutions: {
                $sum: { $cond: ["$response.success", 1, 0] },
              },
              paidExecutions: {
                $sum: { $cond: ["$billing.paid", 1, 0] },
              },
              totalRevenue: {
                $sum: {
                  $cond: [
                    "$billing.paid",
                    { $toDouble: "$billing.costInWei" },
                    0,
                  ],
                },
              },
              averageExecutionTime: {
                $avg: "$response.executionTime",
              },
              uniqueUsers: { $addToSet: "$userId" },
              lastUsed: { $max: "$timestamp" },
              firstUsed: { $min: "$timestamp" },
            },
          },
          {
            $addFields: {
              successRate: {
                $cond: [
                  { $gt: ["$totalExecutions", 0] },
                  { $divide: ["$successfulExecutions", "$totalExecutions"] },
                  0,
                ],
              },
              uniqueUserCount: { $size: "$uniqueUsers" },
            },
          },
        ];

        // Execute aggregations
        const [detailedAnalytics, toolSummaries] = await Promise.all([
          ToolUsage.aggregate(analyticsAggregation),
          ToolUsage.aggregate(summaryAggregation),
        ]);

        // Create tool name mapping
        const toolNameMap = new Map(
          userTools.map((tool) => [tool.toolId, tool.name])
        );

        // Format detailed analytics
        const formattedAnalytics = detailedAnalytics.map((item) => ({
          toolId: item._id.toolId,
          toolName: toolNameMap.get(item._id.toolId) || "Unknown Tool",
          date: item._id.date,
          metrics: {
            totalExecutions: item.totalExecutions,
            successfulExecutions: item.successfulExecutions,
            failedExecutions: item.failedExecutions,
            successRate: Math.round(item.successRate * 100) / 100,
            paidExecutions: item.paidExecutions,
            revenue: {
              wei: item.totalRevenue.toString(),
              eth: EthUtils.weiToEthString(item.totalRevenue.toString()),
              formatted: EthUtils.formatWei(item.totalRevenue.toString()),
            },
            averageExecutionTime: Math.round(item.averageExecutionTime),
            uniqueUsers: item.uniqueUserCount,
          },
        }));

        // Format tool summaries
        const formattedSummaries = toolSummaries.map((summary) => {
          const tool = userTools.find((t) => t.toolId === summary._id);
          return {
            toolId: summary._id,
            toolName: toolNameMap.get(summary._id) || "Unknown Tool",
            pricing: tool
              ? {
                  costInWei: tool.pricing.costInWei,
                  ethCost: tool.pricing.ethCost,
                  formatted: EthUtils.formatWei(tool.pricing.costInWei),
                }
              : null,
            metrics: {
              totalExecutions: summary.totalExecutions,
              successfulExecutions: summary.successfulExecutions,
              successRate: Math.round(summary.successRate * 100) / 100,
              paidExecutions: summary.paidExecutions,
              revenue: {
                wei: summary.totalRevenue.toString(),
                eth: EthUtils.weiToEthString(summary.totalRevenue.toString()),
                formatted: EthUtils.formatWei(summary.totalRevenue.toString()),
              },
              averageExecutionTime: Math.round(summary.averageExecutionTime),
              uniqueUsers: summary.uniqueUserCount,
              lastUsed: summary.lastUsed,
              firstUsed: summary.firstUsed,
            },
          };
        });

        // Calculate totals
        const totalRevenue = toolSummaries.reduce(
          (sum, tool) => sum + tool.totalRevenue,
          0
        );
        const totalUsage = toolSummaries.reduce(
          (sum, tool) => sum + tool.totalExecutions,
          0
        );
        const totalPaidUsage = toolSummaries.reduce(
          (sum, tool) => sum + tool.paidExecutions,
          0
        );

        const response: ApiResponse = {
          success: true,
          message: "Tool usage analytics retrieved successfully",
          data: {
            timeframe,
            groupBy,
            period: {
              start: startDate,
              end: new Date(),
            },
            summary: {
              totalTools: userTools.length,
              totalUsage,
              totalPaidUsage,
              totalRevenue: {
                wei: totalRevenue.toString(),
                eth: EthUtils.weiToEthString(totalRevenue.toString()),
                formatted: EthUtils.formatWei(totalRevenue.toString()),
              },
            },
            toolSummaries: formattedSummaries,
            detailedAnalytics: formattedAnalytics,
          },
        };

        res.status(200).json(response);
      } catch (error) {
        console.error("Error fetching tool usage analytics:", error);
        const response: ApiResponse = {
          success: false,
          message: "Failed to fetch tool usage analytics",
          errors: [error instanceof Error ? error.message : "Unknown error"],
        };
        res.status(500).json(response);
      }
    }
  );

  // POST /user/tools/external-execute - Execute external paid API endpoint
  executeExternalTool = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.uid;
      const { url, method = "POST", headers = {}, body, parameters } = req.body;

      if (!userId) {
        const response: ApiResponse = {
          success: false,
          message: "User ID not found in token",
        };
        res.status(400).json(response);
        return;
      }

      if (!url) {
        const response: ApiResponse = {
          success: false,
          message: "URL is required",
        };
        res.status(400).json(response);
        return;
      }

      try {
        // Get user's CDP account for payments
        const account = await this.cdp.evm.getAccount({
          name: userId,
        });

        // Wrap fetch with payment capability
        const fetchWithPayment = wrapFetchWithPayment(
          fetch,
          toAccount(account)
        );

        // Prepare request configuration
        const requestConfig: any = {
          method: method.toUpperCase(),
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
        };

        // Add body for non-GET requests
        if (method.toUpperCase() !== "GET" && (body || parameters)) {
          requestConfig.body = JSON.stringify(body || parameters);
        }

        // Add query parameters for GET requests
        let finalUrl = url;
        if (method.toUpperCase() === "GET" && parameters) {
          const queryParams = new URLSearchParams();
          Object.entries(parameters).forEach(([key, value]) => {
            queryParams.append(key, String(value));
          });
          finalUrl += finalUrl.includes("?") ? "&" : "?";
          finalUrl += queryParams.toString();
        }

        const startTime = Date.now();
        let paymentResponse: any = null;
        let executionResult: any = null;

        // Execute the paid API call
        try {
          const response = await fetchWithPayment(finalUrl, requestConfig);
          console.log("External API response:", response);
          const executionTime = Date.now() - startTime;

          // Parse response body
          const responseBody = await response.json();

          // Decode payment response if present
          const paymentResponseHeader =
            response.headers.get("x-payment-response");
          if (paymentResponseHeader) {
            paymentResponse = decodeXPaymentResponse(paymentResponseHeader);
          }
          console.log("Payment response:", paymentResponse);
          executionResult = {
            success: response.ok,
            statusCode: response.status,
            data: responseBody,
            executionTime,
            paymentResponse,
            headers: Object.fromEntries(response.headers.entries()),
          };
          console.log("Execution result:", executionResult);
          const apiResponse: ApiResponse = {
            success: true,
            message: "External tool executed successfully",
            data: {
              ...executionResult,
              payment: paymentResponse
                ? {
                    transactionHash: paymentResponse.transactionHash,
                    amount: paymentResponse.amount,
                    currency: paymentResponse.currency,
                    recipient: paymentResponse.recipient,
                    status: paymentResponse.status,
                  }
                : null,
            },
          };
          console.log("API response:", apiResponse);
          res.status(200).json(apiResponse);
        } catch (fetchError: any) {
          const executionTime = Date.now() - startTime;

          // Handle payment or execution errors
          let errorMessage = "External API call failed";
          let statusCode = 500;
          let errorDetails: any = null;

          if (fetchError.response) {
            // HTTP error response
            statusCode = fetchError.response.status;
            errorMessage = `HTTP ${statusCode}: ${fetchError.response.statusText}`;

            try {
              errorDetails = await fetchError.response.json();
            } catch {
              errorDetails = { error: fetchError.response.statusText };
            }

            // Check if it's a payment error (402)
            if (statusCode === 402) {
              errorMessage = "Payment required or payment failed";
              errorDetails = {
                ...errorDetails,
                paymentRequired: true,
                x402Error: true,
              };
            }
          } else {
            // Network or other error
            errorMessage = fetchError.message || "Network error";
            errorDetails = { error: fetchError.message };
          }

          executionResult = {
            success: false,
            statusCode,
            error: errorMessage,
            errorDetails,
            executionTime,
          };

          const apiResponse: ApiResponse = {
            success: false,
            message: errorMessage,
            data: executionResult,
            errors: [errorMessage],
          };

          res.status(statusCode === 402 ? 402 : 500).json(apiResponse);
        }
      } catch (error) {
        console.error("External tool execution error:", error);
        const response: ApiResponse = {
          success: false,
          message: "Failed to execute external tool",
          errors: [error instanceof Error ? error.message : "Unknown error"],
        };
        res.status(500).json(response);
      }
    }
  );

  // GET /user/tools/revenue - Get revenue breakdown for user's tools
  getToolRevenue = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.uid;
      const { timeframe = "30d" } = req.query;

      if (!userId) {
        const response: ApiResponse = {
          success: false,
          message: "User ID not found in token",
        };
        res.status(400).json(response);
        return;
      }

      try {
        // Calculate time range
        const timeRanges = {
          "24h": new Date(Date.now() - 24 * 60 * 60 * 1000),
          "7d": new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          "30d": new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          "90d": new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          "1y": new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        };

        const startDate =
          timeRanges[timeframe as keyof typeof timeRanges] || timeRanges["30d"];

        // Get user's tools
        const userTools = await ApiTool.find({
          userId,
          "metadata.isActive": true,
        }).select("toolId name pricing");

        const toolIds = userTools.map((tool) => tool.toolId);

        // Revenue aggregation by tool and time
        const revenueAggregation = [
          {
            $match: {
              toolId: { $in: toolIds },
              "billing.paid": true,
              timestamp: { $gte: startDate },
            },
          },
          {
            $group: {
              _id: {
                toolId: "$toolId",
                date: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$timestamp",
                  },
                },
              },
              dailyRevenue: {
                $sum: { $toDouble: "$billing.costInWei" },
              },
              transactions: { $sum: 1 },
              uniqueUsers: { $addToSet: "$userId" },
            },
          },
          {
            $group: {
              _id: "$_id.toolId",
              totalRevenue: { $sum: "$dailyRevenue" },
              totalTransactions: { $sum: "$transactions" },
              dailyBreakdown: {
                $push: {
                  date: "$_id.date",
                  revenue: "$dailyRevenue",
                  transactions: "$transactions",
                  uniqueUsers: { $size: "$uniqueUsers" },
                },
              },
              averageDailyRevenue: { $avg: "$dailyRevenue" },
            },
          },
          { $sort: { totalRevenue: -1 as 1 | -1 } },
        ];

        const revenueData = await ToolUsage.aggregate(revenueAggregation);

        // Format response
        const revenueBreakdown = revenueData.map((item) => {
          const tool = userTools.find((t) => t.toolId === item._id);
          return {
            toolId: item._id,
            toolName: tool?.name || "Unknown Tool",
            pricing: tool
              ? {
                  costInWei: tool.pricing.costInWei,
                  ethCost: tool.pricing.ethCost,
                  formatted: EthUtils.formatWei(tool.pricing.costInWei),
                }
              : null,
            revenue: {
              total: {
                wei: item.totalRevenue.toString(),
                eth: EthUtils.weiToEthString(item.totalRevenue.toString()),
                formatted: EthUtils.formatWei(item.totalRevenue.toString()),
              },
              averageDaily: {
                wei: Math.floor(item.averageDailyRevenue).toString(),
                eth: EthUtils.weiToEthString(
                  Math.floor(item.averageDailyRevenue).toString()
                ),
                formatted: EthUtils.formatWei(
                  Math.floor(item.averageDailyRevenue).toString()
                ),
              },
            },
            transactions: item.totalTransactions,
            dailyBreakdown: item.dailyBreakdown.sort(
              (a: any, b: any) =>
                new Date(a.date).getTime() - new Date(b.date).getTime()
            ),
          };
        });

        const totalRevenue = revenueData.reduce(
          (sum, item) => sum + item.totalRevenue,
          0
        );
        const totalTransactions = revenueData.reduce(
          (sum, item) => sum + item.totalTransactions,
          0
        );

        const response: ApiResponse = {
          success: true,
          message: "Revenue data retrieved successfully",
          data: {
            timeframe,
            period: {
              start: startDate,
              end: new Date(),
            },
            summary: {
              totalRevenue: {
                wei: totalRevenue.toString(),
                eth: EthUtils.weiToEthString(totalRevenue.toString()),
                formatted: EthUtils.formatWei(totalRevenue.toString()),
              },
              totalTransactions,
              averageRevenuePerTransaction:
                totalTransactions > 0
                  ? {
                      wei: Math.floor(
                        totalRevenue / totalTransactions
                      ).toString(),
                      eth: EthUtils.weiToEthString(
                        Math.floor(totalRevenue / totalTransactions).toString()
                      ),
                      formatted: EthUtils.formatWei(
                        Math.floor(totalRevenue / totalTransactions).toString()
                      ),
                    }
                  : { wei: "0", eth: "0", formatted: "0 wei" },
            },
            tools: revenueBreakdown,
          },
        };

        res.status(200).json(response);
      } catch (error) {
        console.error("Error fetching revenue data:", error);
        const response: ApiResponse = {
          success: false,
          message: "Failed to fetch revenue data",
          errors: [error instanceof Error ? error.message : "Unknown error"],
        };
        res.status(500).json(response);
      }
    }
  );

  // GET /user/tools/performance - Get performance metrics for user's tools
  getToolPerformance = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.uid;
      const { toolId } = req.query;

      if (!userId) {
        const response: ApiResponse = {
          success: false,
          message: "User ID not found in token",
        };
        res.status(400).json(response);
        return;
      }

      try {
        // Get user's tools
        let toolQuery: any = { userId, "metadata.isActive": true };
        if (toolId) {
          toolQuery.toolId = toolId;
        }

        const userTools = await ApiTool.find(toolQuery).select(
          "toolId name pricing"
        );

        if (userTools.length === 0) {
          const response: ApiResponse = {
            success: true,
            message: "No tools found",
            data: { tools: [] },
          };
          res.status(200).json(response);
          return;
        }

        const toolIds = userTools.map((tool) => tool.toolId);

        // Performance metrics aggregation
        const performanceAggregation = [
          { $match: { toolId: { $in: toolIds } } },
          {
            $group: {
              _id: "$toolId",
              totalExecutions: { $sum: 1 },
              successfulExecutions: {
                $sum: { $cond: ["$response.success", 1, 0] },
              },
              averageExecutionTime: {
                $avg: "$response.executionTime",
              },
              minExecutionTime: {
                $min: "$response.executionTime",
              },
              maxExecutionTime: {
                $max: "$response.executionTime",
              },
              errorRate: {
                $avg: { $cond: ["$response.success", 0, 1] },
              },
              uniqueUsers: { $addToSet: "$userId" },
              recentExecutions: {
                $push: {
                  $cond: [
                    {
                      $gte: [
                        "$timestamp",
                        new Date(Date.now() - 24 * 60 * 60 * 1000),
                      ],
                    },
                    {
                      timestamp: "$timestamp",
                      success: "$response.success",
                      executionTime: "$response.executionTime",
                      userId: "$userId",
                    },
                    "$$REMOVE",
                  ],
                },
              },
            },
          },
          {
            $addFields: {
              successRate: {
                $cond: [
                  { $gt: ["$totalExecutions", 0] },
                  { $divide: ["$successfulExecutions", "$totalExecutions"] },
                  0,
                ],
              },
              uniqueUserCount: { $size: "$uniqueUsers" },
              recentExecutionCount: { $size: "$recentExecutions" },
            },
          },
        ];

        const performanceData = await ToolUsage.aggregate(
          performanceAggregation
        );

        // Format response
        const toolPerformance = performanceData.map((item) => {
          const tool = userTools.find((t) => t.toolId === item._id);
          return {
            toolId: item._id,
            toolName: tool?.name || "Unknown Tool",
            metrics: {
              reliability: {
                totalExecutions: item.totalExecutions,
                successfulExecutions: item.successfulExecutions,
                successRate: Math.round(item.successRate * 100) / 100,
                errorRate: Math.round(item.errorRate * 100) / 100,
              },
              performance: {
                averageExecutionTime: Math.round(item.averageExecutionTime),
                minExecutionTime: item.minExecutionTime,
                maxExecutionTime: item.maxExecutionTime,
              },
              usage: {
                uniqueUsers: item.uniqueUserCount,
                recent24hExecutions: item.recentExecutionCount,
              },
            },
            status: this.getToolHealthStatus(
              item.successRate,
              item.averageExecutionTime
            ),
          };
        });

        const response: ApiResponse = {
          success: true,
          message: "Tool performance metrics retrieved successfully",
          data: {
            tools: toolPerformance,
            summary: {
              totalTools: toolPerformance.length,
              averageSuccessRate:
                toolPerformance.length > 0
                  ? Math.round(
                      toolPerformance.reduce(
                        (sum, tool) =>
                          sum + tool.metrics.reliability.successRate,
                        0
                      ) / toolPerformance.length
                    ) / 100
                  : 0,
              healthyTools: toolPerformance.filter(
                (tool) => tool.status === "healthy"
              ).length,
              warningTools: toolPerformance.filter(
                (tool) => tool.status === "warning"
              ).length,
              criticalTools: toolPerformance.filter(
                (tool) => tool.status === "critical"
              ).length,
            },
          },
        };

        res.status(200).json(response);
      } catch (error) {
        console.error("Error fetching tool performance:", error);
        const response: ApiResponse = {
          success: false,
          message: "Failed to fetch tool performance metrics",
          errors: [error instanceof Error ? error.message : "Unknown error"],
        };
        res.status(500).json(response);
      }
    }
  );

  // Helper method to determine tool health status
  private getToolHealthStatus(
    successRate: number,
    avgExecutionTime: number
  ): "healthy" | "warning" | "critical" {
    if (successRate >= 0.95 && avgExecutionTime < 5000) {
      return "healthy";
    } else if (successRate >= 0.85 && avgExecutionTime < 10000) {
      return "warning";
    } else {
      return "critical";
    }
  }

  // POST /tools/execute - Execute a specific tool
  executeTool = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.uid;
      const { toolId, parameters, sessionId } = req.body;

      if (!userId) {
        const response: ApiResponse = {
          success: false,
          message: "User ID not found in token",
        };
        res.status(400).json(response);
        return;
      }

      if (!toolId || !parameters) {
        const response: ApiResponse = {
          success: false,
          message: "Tool ID and parameters are required",
        };
        res.status(400).json(response);
        return;
      }

      try {
        // Get tool definition
        const tool = (await ApiTool.findOne({
          toolId,
          "metadata.isActive": true,
        })) as IApiTool;

        if (!tool) {
          const response: ApiResponse = {
            success: false,
            message: "Tool not found or inactive",
          };
          res.status(404).json(response);
          return;
        }
        // const price = formatEther(
        //   BigInt(tool.pricing.costInWei) / BigInt(1000)
        // );
        // console.log("Tool price in ETH:", price.toString());
        // const { address } = await this.cdp.evm.getOrCreateAccount({
        //   name: tool.userId,
        // });
        // const resource =
        //   `${req.protocol}://${req.headers.host}${req.originalUrl}` as Resource;
        // const paymentRequirements = [
        //   createExactPaymentRequirements(
        //     parseFloat(price.toString()).toString(), // Expect dynamic pricing
        //     "base-sepolia",
        //     resource,
        //     "Access to weather data",
        //     address
        //   ),
        // ];

        // const isValid = await verifyPayment(req, res, paymentRequirements);
        // if (!isValid) return;

        // const settleResponse = await settle(
        //   exact.evm.decodePayment(req.header("X-PAYMENT")!),
        //   paymentRequirements[0]
        // );
        // const responseHeader = settleResponseHeader(settleResponse);
        // res.setHeader("X-PAYMENT-RESPONSE", responseHeader);
        // Execute tool
        const result = await this.toolExecutorService.executeTool(
          tool,
          parameters,
          userId,
          sessionId || generateId()
        );

        const response: ApiResponse = {
          success: result.success,
          message: result.success
            ? "Tool executed successfully"
            : "Tool execution failed",
          data: {
            ...result,
            billing: {
              ...result.billing,
              formatted: EthUtils.formatWei(result.billing.costInWei),
            },
          },
        };

        res.status(result.success ? 200 : 400).json(response);
      } catch (error) {
        console.error("Tool execution error:", error);
        const response: ApiResponse = {
          success: false,
          message: "Failed to execute tool",
          errors: [error instanceof Error ? error.message : "Unknown error"],
        };
        res.status(500).json(response);
      }
    }
  );

  searchTools = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.uid;
      const {
        q: query,
        category,
        maxCost,
        tags,
        limit = 20,
        myTools = false,
      } = req.query;

      if (!userId) {
        const response: ApiResponse = {
          success: false,
          message: "User ID not found in token",
        };
        res.status(400).json(response);
        return;
      }

      try {
        let tools: IApiTool[];

        if (query && typeof query === "string" && query.trim() !== "") {
          // Semantic search with query
          const filters: ToolSearchFilters = {};

          if (category) filters.category = category as string;
          if (maxCost) {
            // Convert maxCost from ETH to wei for comparison
            const maxCostInWei = EthUtils.ethToWei(maxCost as string);
            filters.maxCost = parseInt(maxCostInWei);
          }
          if (tags) {
            filters.tags =
              typeof tags === "string" ? [tags] : (tags as string[]);
          }
          if (myTools === "true") filters.userId = userId;

          tools = await this.toolDiscoveryService.searchToolsGlobally(
            query,
            filters,
            parseInt(limit as string)
          );
        } else {
          // Get tools by category or all public tools without semantic search
          const searchCriteria: any = {
            "metadata.isActive": true,
          };

          if (myTools === "true") {
            searchCriteria.userId = userId;
            delete searchCriteria["metadata.isPublic"];
          } else {
            searchCriteria["metadata.isPublic"] = true;
          }

          if (category) {
            searchCriteria.category = { $regex: category, $options: "i" };
          }

          if (maxCost) {
            searchCriteria["pricing.costInWei"] = {
              $lte: EthUtils.ethToWei(maxCost as string),
            };
          }

          if (tags) {
            const tagArray =
              typeof tags === "string" ? [tags] : (tags as string[]);
            searchCriteria["metadata.tags"] = { $in: tagArray };
          }

          tools = (await ApiTool.find(searchCriteria)
            .limit(parseInt(limit as string))
            .sort({ createdAt: -1 })
            .lean()) as IApiTool[];
        }

        // Format response with readable pricing
        const formattedTools = tools.map((tool) => ({
          toolId: tool.toolId,
          name: tool.name,
          description: tool.description,
          category: tool.category,
          pricing: {
            costInWei: tool.pricing.costInWei,
            ethCost:
              tool.pricing.ethCost ||
              EthUtils.weiToEthString(tool.pricing.costInWei),
            formatted: EthUtils.formatWei(tool.pricing.costInWei),
          },
          parameters: tool.parameters,
          metadata: tool.metadata,
          createdBy: tool.userId,
          createdAt: tool.createdAt,
        }));

        const response: ApiResponse = {
          success: true,
          message: "Tools retrieved successfully",
          data: {
            tools: formattedTools,
            count: formattedTools.length,
            query: query || null,
            filters: {
              category,
              maxCost,
              tags,
              myTools: myTools === "true",
            },
          },
        };

        res.status(200).json(response);
      } catch (error) {
        console.error("Error searching tools:", error);
        const response: ApiResponse = {
          success: false,
          message: "Failed to search tools",
          errors: [error instanceof Error ? error.message : "Unknown error"],
        };
        res.status(500).json(response);
      }
    }
  );

  // Also update the getPopularTools method to use the global version:
  getPopularTools = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.uid;
      const { limit = 10 } = req.query;

      if (!userId) {
        const response: ApiResponse = {
          success: false,
          message: "User ID not found in token",
        };
        res.status(400).json(response);
        return;
      }

      try {
        const popularTools =
          await this.toolDiscoveryService.getPopularToolsGlobally(
            parseInt(limit as string)
          );

        const formattedTools = popularTools.map((tool) => ({
          toolId: tool.toolId,
          name: tool.name,
          description: tool.description,
          category: tool.category,
          pricing: {
            costInWei: tool.pricing.costInWei,
            ethCost: tool.pricing.ethCost,
            formatted: EthUtils.formatWei(tool.pricing.costInWei),
          },
          stats: {
            usageCount: tool.usageCount,
            successRate: Math.round(tool.successRate * 100) / 100,
          },
          metadata: tool.metadata,
          createdAt: tool.createdAt,
        }));

        const response: ApiResponse = {
          success: true,
          message: "Popular tools retrieved successfully",
          data: {
            tools: formattedTools,
            count: formattedTools.length,
          },
        };

        res.status(200).json(response);
      } catch (error) {
        console.error("Error fetching popular tools:", error);
        const response: ApiResponse = {
          success: false,
          message: "Failed to fetch popular tools",
          errors: [error instanceof Error ? error.message : "Unknown error"],
        };
        res.status(500).json(response);
      }
    }
  );
  // GET /tools/categories - Get available tool categories
  getToolCategories = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.uid;

      if (!userId) {
        const response: ApiResponse = {
          success: false,
          message: "User ID not found in token",
        };
        res.status(400).json(response);
        return;
      }

      try {
        const categories = await ApiTool.aggregate([
          { $match: { "metadata.isActive": true, "metadata.isPublic": true } },
          {
            $group: {
              _id: "$category",
              count: { $sum: 1 },
              avgCost: { $avg: { $toDouble: "$pricing.costInWei" } },
            },
          },
          { $sort: { count: -1 } },
        ]);

        const formattedCategories = categories.map((cat) => ({
          category: cat._id,
          toolCount: cat.count,
          avgCostInWei: Math.floor(cat.avgCost).toString(),
          avgCostFormatted: EthUtils.formatWei(
            Math.floor(cat.avgCost).toString()
          ),
        }));

        const response: ApiResponse = {
          success: true,
          message: "Categories retrieved successfully",
          data: {
            categories: formattedCategories,
            totalCategories: categories.length,
          },
        };

        res.status(200).json(response);
      } catch (error) {
        console.error("Error fetching categories:", error);
        const response: ApiResponse = {
          success: false,
          message: "Failed to fetch categories",
          errors: [error instanceof Error ? error.message : "Unknown error"],
        };
        res.status(500).json(response);
      }
    }
  );

  // POST /addMedia
  addMedia = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.uid;
    const { filename, mimeType, size, metadata }: AddMediaRequest = req.body;

    if (!userId) {
      const response: ApiResponse = {
        success: false,
        message: "User ID not found in token",
      };
      res.status(400).json(response);
      return;
    }

    if (!filename || !mimeType || !size) {
      const response: ApiResponse = {
        success: false,
        message: "Filename, mimeType, and size are required",
      };
      res.status(400).json(response);
      return;
    }

    // Mock URL generation (in production, this would be actual file upload to storage)
    const mockUrl = `https://storage.example.com/media/${userId}/${generateId()}-${filename}`;

    const newMedia: Media = {
      id: generateId(),
      userId,
      filename: filename.trim(),
      originalName: filename.trim(),
      mimeType: mimeType.trim(),
      size,
      url: mockUrl,
      metadata: metadata || {},
      createdAt: new Date(),
    };

    // Store media
    if (!this.media.has(userId)) {
      this.media.set(userId, []);
    }
    this.media.get(userId)!.push(newMedia);

    const response: ApiResponse = {
      success: true,
      message: "Media added successfully",
      data: newMedia,
    };

    res.status(201).json(response);
  });

  // Helper method to generate mock chat responses
  private generateMockChatResponse(message: string): string {
    const responses = [
      "I understand your question. Let me help you with that.",
      "That's an interesting point. Here's what I think...",
      "Based on your message, I would suggest...",
      "Thank you for your question. Here's my response...",
      "I'm processing your request. Let me provide you with information.",
    ];

    // Simple mock logic based on message content
    if (message.toLowerCase().includes("help")) {
      return "I'm here to help! What specific assistance do you need?";
    }

    if (
      message.toLowerCase().includes("balance") ||
      message.toLowerCase().includes("account")
    ) {
      return "I can help you check your account balance. You can use the /getAccount endpoint for detailed information.";
    }

    if (message.toLowerCase().includes("tool")) {
      return "I can assist you with managing tools. You can add new tools using the /addTool endpoint.";
    }

    // Return a random response
    return responses[Math.floor(Math.random() * responses.length)];
  }
}
