import { OpenAIEmbeddings } from "@langchain/openai";
import { ApiTool, IApiTool } from "../models/apiTool.js";
import { cosineSimilarity } from "../utils/vectorUtils.js";

export interface ToolSearchFilters {
  category?: string;
  maxCost?: number; // Maximum cost in wei as number
  tags?: string[];
  userId?: string; // Optional - if provided, search only user's tools
}

export class ToolDiscoveryService {
  private embeddings: OpenAIEmbeddings;

  constructor() {
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: "text-embedding-3-small",
    });
  }

  async registerApiTool(
    userId: string,
    toolData: Partial<IApiTool>
  ): Promise<IApiTool> {
    // Generate embedding for semantic search
    const searchText = `${toolData.name} ${toolData.description} ${
      toolData.category
    } ${toolData.parameters?.map((p) => p.description).join(" ")}`;
    const embedding = await this.embeddings.embedQuery(searchText);

    const tool = new ApiTool({
      ...toolData,
      userId,
      toolId: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      embedding,
      updatedAt: new Date(),
    });

    return await tool.save();
  }

  // Global search - available to everyone including AI agents
  async searchToolsGlobally(
    query: string,
    filters: ToolSearchFilters = {},
    limit: number = 10
  ): Promise<IApiTool[]> {
    // Validate query parameter
    if (!query || typeof query !== "string" || query.trim() === "") {
      throw new Error("Query must be a non-empty string");
    }

    // Generate embedding for the query
    const queryEmbedding = await this.embeddings.embedQuery(query.trim());

    // Build search criteria for public tools
    const searchCriteria: any = {
      "metadata.isActive": true,
      "metadata.isPublic": true,
    };

    // Apply filters
    if (filters.category) {
      searchCriteria.category = { $regex: filters.category, $options: "i" };
    }

    if (filters.maxCost !== undefined) {
      // Convert maxCost to string for comparison with costInWei
      searchCriteria["pricing.costInWei"] = {
        $lte: filters.maxCost.toString(),
      };
    }

    if (filters.tags && filters.tags.length > 0) {
      searchCriteria["metadata.tags"] = { $in: filters.tags };
    }

    if (filters.userId) {
      // If userId provided, search only that user's tools (for personal tool management)
      searchCriteria.userId = filters.userId;
      delete searchCriteria["metadata.isPublic"]; // Allow private tools for owner
    }

    // Get tools from database
    const tools = await ApiTool.find(searchCriteria).lean();

    // Calculate semantic similarity scores
    const toolsWithScores = tools
      .filter((tool) => tool.embedding && tool.embedding.length > 0)
      .map((tool) => ({
        tool,
        similarity: cosineSimilarity(queryEmbedding, tool.embedding!),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return toolsWithScores.map((item) => item.tool as IApiTool);
  }

  // User-specific search (for personal tool management)
  async searchTools(
    userId: string,
    query: string,
    category?: string,
    limit: number = 10
  ): Promise<IApiTool[]> {
    // Validate query parameter
    if (!query || typeof query !== "string" || query.trim() === "") {
      throw new Error("Query must be a non-empty string");
    }

    // Generate embedding for the query
    const queryEmbedding = await this.embeddings.embedQuery(query.trim());

    // Build search criteria for user's tools only
    const searchCriteria: any = {
      userId,
      "metadata.isActive": true,
    };

    if (category) {
      searchCriteria.category = { $regex: category, $options: "i" };
    }

    // Get tools from database
    const tools = await ApiTool.find(searchCriteria).lean();

    // Calculate semantic similarity scores
    const toolsWithScores = tools
      .filter((tool) => tool.embedding && tool.embedding.length > 0)
      .map((tool) => ({
        tool,
        similarity: cosineSimilarity(queryEmbedding, tool.embedding!),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return toolsWithScores.map((item) => item.tool as IApiTool);
  }

  // For AI agents to search tools by category and price range
  async getToolsByCategory(
    category: string,
    maxCost?: number,
    limit: number = 20
  ): Promise<IApiTool[]> {
    const searchCriteria: any = {
      "metadata.isActive": true,
      "metadata.isPublic": true,
      category: { $regex: category, $options: "i" },
    };

    if (maxCost !== undefined) {
      searchCriteria["pricing.costInWei"] = { $lte: maxCost.toString() };
    }

    return (await ApiTool.find(searchCriteria)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean()) as IApiTool[];
  }

  // Get user's tools by category
  async getUserToolsByCategory(
    userId: string,
    category: string
  ): Promise<IApiTool[]> {
    return await ApiTool.find({
      userId,
      category: { $regex: category, $options: "i" },
      "metadata.isActive": true,
    }).sort({ updatedAt: -1 });
  }

  async getToolById(toolId: string): Promise<IApiTool | null> {
    return await ApiTool.findOne({ toolId, "metadata.isActive": true });
  }

  async updateTool(
    toolId: string,
    updates: Partial<IApiTool>
  ): Promise<IApiTool | null> {
    // Regenerate embedding if description changed
    if (updates.name || updates.description || updates.category) {
      const searchText = `${updates.name} ${updates.description} ${updates.category}`;
      updates.embedding = await this.embeddings.embedQuery(searchText);
    }

    return await ApiTool.findOneAndUpdate(
      { toolId },
      { ...updates, updatedAt: new Date() },
      { new: true }
    );
  }

  async deactivateTool(toolId: string): Promise<boolean> {
    const result = await ApiTool.updateOne(
      { toolId },
      { "metadata.isActive": false, updatedAt: new Date() }
    );
    return result.modifiedCount > 0;
  }

  // Get popular tools globally
  async getPopularToolsGlobally(limit: number = 5): Promise<any[]> {
    return await ApiTool.aggregate([
      { $match: { "metadata.isActive": true, "metadata.isPublic": true } },
      {
        $lookup: {
          from: "toolusages",
          localField: "toolId",
          foreignField: "toolId",
          as: "usages",
        },
      },
      {
        $addFields: {
          usageCount: { $size: "$usages" },
          successRate: {
            $cond: {
              if: { $gt: [{ $size: "$usages" }, 0] },
              then: {
                $divide: [
                  {
                    $size: {
                      $filter: {
                        input: "$usages",
                        cond: { $eq: ["$$this.response.success", true] },
                      },
                    },
                  },
                  { $size: "$usages" },
                ],
              },
              else: 0,
            },
          },
        },
      },
      { $sort: { usageCount: -1, successRate: -1 } },
      { $limit: limit },
    ]);
  }

  // Get popular tools for a specific user
  async getPopularTools(userId: string, limit: number = 5): Promise<any[]> {
    return await ApiTool.aggregate([
      { $match: { userId, "metadata.isActive": true } },
      {
        $lookup: {
          from: "toolusages",
          localField: "toolId",
          foreignField: "toolId",
          as: "usages",
        },
      },
      {
        $addFields: {
          usageCount: { $size: "$usages" },
          successRate: {
            $cond: {
              if: { $gt: [{ $size: "$usages" }, 0] },
              then: {
                $divide: [
                  {
                    $size: {
                      $filter: {
                        input: "$usages",
                        cond: { $eq: ["$$this.response.success", true] },
                      },
                    },
                  },
                  { $size: "$usages" },
                ],
              },
              else: 0,
            },
          },
        },
      },
      { $sort: { usageCount: -1, successRate: -1 } },
      { $limit: limit },
    ]);
  }

  // Get all available categories
  async getAllCategories(): Promise<
    Array<{ category: string; count: number; avgCost: string }>
  > {
    const categories = await ApiTool.aggregate([
      { $match: { "metadata.isActive": true, "metadata.isPublic": true } },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
          avgCostInWei: {
            $avg: { $convert: { input: "$pricing.costInWei", to: "double" } },
          },
        },
      },
      { $sort: { count: -1 } },
    ]);

    return categories.map((cat) => ({
      category: cat._id,
      count: cat.count,
      avgCost: Math.floor(cat.avgCostInWei || 0).toString(),
    }));
  }
}
