import mongoose, { Schema, Document } from "mongoose";

export interface IChatMessage extends Document {
  id: string;
  userId: string;
  message: string;
  response: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

const ChatHistorySchema = new Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  message: { type: String, required: true },
  response: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  metadata: { type: Schema.Types.Mixed, default: {} },
});

// Index for efficient querying
ChatHistorySchema.index({ userId: 1, timestamp: -1 });

export const ChatHistory = mongoose.model<IChatMessage>(
  "ChatHistory",
  ChatHistorySchema
);
