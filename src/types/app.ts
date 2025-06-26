export interface Account {
  id: string;
  userId: string;
  balance: number;
  currency: string;
  walletAddress?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  userId: string;
  message: string;
  response?: string;
  timestamp: Date;
}

export interface ChatRequest {
  message: string;
  context?: string;
}

export interface TopupRequest {
  amount: number;
  currency: string;
  paymentMethod: string;
}

export interface TopupResponse {
  transactionId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed';
  timestamp: Date;
}

export interface Tool {
  id: string;
  userId: string;
  name: string;
  description: string;
  type: string;
  config: Record<string, any>;
  isActive: boolean;
  createdAt: Date;
}

export interface AddToolRequest {
  name: string;
  description: string;
  type: string;
  config?: Record<string, any>;
}

export interface Media {
  id: string;
  userId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface AddMediaRequest {
  filename: string;
  mimeType: string;
  size: number;
  metadata?: Record<string, any>;
}
