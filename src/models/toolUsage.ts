import mongoose, { Schema, Document } from "mongoose";

export interface IToolUsage extends Document {
  toolId: string;
  userId: string; // User who executed the tool
  sessionId: string;
  parameters: Record<string, any>;
  response: {
    success: boolean;
    data?: any;
    error?: string;
    statusCode?: number;
    executionTime: number;
  };
  billing: {
    costInWei: string;
    paid: boolean;
    transactionHash?: string;
    paymentTimestamp?: Date;
  };
  timestamp: Date;
}

const ToolUsageSchema = new Schema({
  toolId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true },
  parameters: { type: Schema.Types.Mixed, required: true },
  response: {
    success: { type: Boolean, required: true },
    data: Schema.Types.Mixed,
    error: String,
    statusCode: Number,
    executionTime: { type: Number, required: true },
  },
  billing: {
    costInWei: { type: String, required: true },
    paid: { type: Boolean, default: false },
    transactionHash: String,
    paymentTimestamp: Date,
  },
  timestamp: { type: Date, default: Date.now },
});

// Indexes for billing and analytics
ToolUsageSchema.index({ "billing.paid": 1 });
ToolUsageSchema.index({ userId: 1, timestamp: -1 });

export const ToolUsage = mongoose.model<IToolUsage>(
  "ToolUsage",
  ToolUsageSchema
);
