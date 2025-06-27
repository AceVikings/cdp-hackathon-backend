import { ChatHistory, IChatMessage } from "../models/chatHistory.js";
import { ChatMessage } from "../types/app.js";

export class ChatHistoryService {
  async saveChatMessage(chatMessage: ChatMessage): Promise<IChatMessage> {
    const chatDoc = new ChatHistory({
      id: chatMessage.id,
      userId: chatMessage.userId,
      message: chatMessage.message,
      response: chatMessage.response,
      timestamp: chatMessage.timestamp,
      metadata: {},
    });

    return await chatDoc.save();
  }

  async getChatHistory(
    userId: string,
    limit: number = 10
  ): Promise<ChatMessage[]> {
    const chatDocs = await ChatHistory.find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    // Convert to ChatMessage format and reverse to get chronological order
    return chatDocs.reverse().map((doc) => ({
      id: doc.id,
      userId: doc.userId,
      message: doc.message,
      response: doc.response,
      timestamp: doc.timestamp,
    }));
  }

  async getRecentMessages(
    userId: string,
    count: number = 5
  ): Promise<ChatMessage[]> {
    return this.getChatHistory(userId, count);
  }

  async deleteChatHistory(userId: string): Promise<boolean> {
    const result = await ChatHistory.deleteMany({ userId });
    return result.deletedCount > 0;
  }

  async getChatMessageById(messageId: string): Promise<ChatMessage | null> {
    const chatDoc = await ChatHistory.findOne({ id: messageId }).lean();

    if (!chatDoc) return null;

    return {
      id: chatDoc.id,
      userId: chatDoc.userId,
      message: chatDoc.message,
      response: chatDoc.response,
      timestamp: chatDoc.timestamp,
    };
  }
}
