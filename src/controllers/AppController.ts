import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/firebaseAuth";
import { ApiResponse } from "../types/api";
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
} from "../types/app";
import { CdpClient } from "@coinbase/cdp-sdk";
import { asyncHandler } from "../utils/asyncHandler";
import { generateId } from "../utils/helpers";
import { config } from "../config";
export class AppController {
  // Mock data storage (in production, this would be a database)
  private accounts = new Map<string, Account>();
  private chatHistory = new Map<string, ChatMessage[]>();
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

  // POST /chat
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

    // Mock AI response
    const mockResponse = this.generateMockChatResponse(message);

    const chatMessage: ChatMessage = {
      id: generateId(),
      userId,
      message: message.trim(),
      response: mockResponse,
      timestamp: new Date(),
    };

    // Store chat history
    if (!this.chatHistory.has(userId)) {
      this.chatHistory.set(userId, []);
    }
    this.chatHistory.get(userId)!.push(chatMessage);

    const response: ApiResponse = {
      success: true,
      message: "Chat message processed successfully",
      data: {
        id: chatMessage.id,
        response: mockResponse,
        timestamp: chatMessage.timestamp,
      },
    };

    res.status(200).json(response);
  });

  // POST /topup
  topup = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.uid;
    const { amount, currency, paymentMethod }: TopupRequest = req.body;

    if (!userId) {
      const response: ApiResponse = {
        success: false,
        message: "User ID not found in token",
      };
      res.status(400).json(response);
      return;
    }

    if (!amount || amount <= 0) {
      const response: ApiResponse = {
        success: false,
        message: "Valid amount is required",
      };
      res.status(400).json(response);
      return;
    }

    if (!currency || !paymentMethod) {
      const response: ApiResponse = {
        success: false,
        message: "Currency and payment method are required",
      };
      res.status(400).json(response);
      return;
    }

    // Mock topup process
    const topupResult: TopupResponse = {
      transactionId: generateId(),
      amount,
      currency: currency.toUpperCase(),
      status: "completed", // Mock successful transaction
      timestamp: new Date(),
    };

    // Update account balance
    let account = this.accounts.get(userId);
    if (account && account.currency === currency.toUpperCase()) {
      account.balance += amount;
      account.updatedAt = new Date();
      this.accounts.set(userId, account);
    }

    const response: ApiResponse = {
      success: true,
      message: "Topup completed successfully",
      data: topupResult,
    };

    res.status(200).json(response);
  });

  // POST /addTool
  addTool = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.uid;
    const { name, description, type, config }: AddToolRequest = req.body;

    if (!userId) {
      const response: ApiResponse = {
        success: false,
        message: "User ID not found in token",
      };
      res.status(400).json(response);
      return;
    }

    if (!name || !description || !type) {
      const response: ApiResponse = {
        success: false,
        message: "Name, description, and type are required",
      };
      res.status(400).json(response);
      return;
    }

    const newTool: Tool = {
      id: generateId(),
      userId,
      name: name.trim(),
      description: description.trim(),
      type: type.trim(),
      config: config || {},
      isActive: true,
      createdAt: new Date(),
    };

    // Store tool
    if (!this.tools.has(userId)) {
      this.tools.set(userId, []);
    }
    this.tools.get(userId)!.push(newTool);

    const response: ApiResponse = {
      success: true,
      message: "Tool added successfully",
      data: newTool,
    };

    res.status(201).json(response);
  });

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
