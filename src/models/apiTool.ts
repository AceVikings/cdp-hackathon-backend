import mongoose, { Schema, Document } from "mongoose";

export interface IApiTool extends Document {
  toolId: string;
  userId: string; // Creator of the tool
  name: string;
  description: string;
  category: string;
  apiConfig: {
    endpoint: string;
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    headers?: Record<string, string>;
    timeout?: number;
    retries?: number;
  };
  parameters: {
    name: string;
    type: "string" | "number" | "boolean" | "object" | "array";
    required: boolean;
    description: string;
    defaultValue?: any;
    validation?: {
      min?: number;
      max?: number;
      pattern?: string;
      enum?: any[];
    };
  }[];
  responseSchema: {
    structure: Record<string, any>;
    description: string;
  };
  pricing: {
    costInWei: string; // Cost per execution in wei (as string to handle big numbers)
    ethCost?: string; // Optional: human-readable ETH cost for display
  };
  metadata: {
    tags: string[];
    version: string;
    lastTested?: Date;
    isActive: boolean;
    isPublic: boolean; // Whether tool is searchable by everyone
    rateLimits?: {
      requests: number;
      window: number; // in seconds
    };
  };
  embedding?: number[]; // For semantic search
  createdAt: Date;
  updatedAt: Date;
}

const ApiToolSchema = new Schema({
  toolId: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true }, // Creator
  name: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true, index: true },
  apiConfig: {
    endpoint: { type: String, required: true },
    method: {
      type: String,
      enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      default: "POST",
    },
    headers: { type: Schema.Types.Mixed, default: {} },
    timeout: { type: Number, default: 30000 },
    retries: { type: Number, default: 3 },
  },
  parameters: [
    {
      name: { type: String, required: true },
      type: {
        type: String,
        enum: ["string", "number", "boolean", "object", "array"],
        required: true,
      },
      required: { type: Boolean, default: false },
      description: { type: String, required: true },
      defaultValue: Schema.Types.Mixed,
      validation: {
        min: Number,
        max: Number,
        pattern: String,
        enum: [Schema.Types.Mixed],
      },
    },
  ],
  responseSchema: {
    structure: { type: Schema.Types.Mixed, required: true },
    description: { type: String, required: true },
  },
  pricing: {
    costInWei: {
      type: String,
      required: true,
      validate: {
        validator: function (v: string) {
          // Validate that it's a valid wei amount (positive integer as string)
          return /^\d+$/.test(v) && BigInt(v) >= 0n;
        },
        message: "Cost must be a valid wei amount (positive integer as string)",
      },
    },
    ethCost: { type: String }, // Optional display value like "0.001"
  },
  metadata: {
    tags: [{ type: String }],
    version: { type: String, default: "1.0.0" },
    lastTested: Date,
    isActive: { type: Boolean, default: true },
    isPublic: { type: Boolean, default: true }, // Public by default
    rateLimits: {
      requests: Number,
      window: Number,
    },
  },
  embedding: [Number],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Indexes for efficient querying
ApiToolSchema.index({ "metadata.isActive": 1, "metadata.isPublic": 1 });
ApiToolSchema.index({ category: 1, "metadata.isActive": 1 });
ApiToolSchema.index({ "metadata.tags": 1 });
ApiToolSchema.index({ "pricing.costInWei": 1 });
ApiToolSchema.index({ embedding: "2dsphere" }); // For vector search

export const ApiTool = mongoose.model<IApiTool>("ApiTool", ApiToolSchema);
