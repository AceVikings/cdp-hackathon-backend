import { Request, Response, NextFunction } from 'express';

// Simple rate limiter implementation without external dependency
const requestCounts = new Map<string, { count: number; resetTime: number }>();

const createLimiter = (windowMs: number, max: number) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientId = req.ip || 'unknown';
    const now = Date.now();
    
    const clientData = requestCounts.get(clientId);
    
    if (!clientData || now > clientData.resetTime) {
      requestCounts.set(clientId, {
        count: 1,
        resetTime: now + windowMs,
      });
      next();
      return;
    }
    
    if (clientData.count >= max) {
      res.status(429).json({
        success: false,
        message: 'Too many requests from this IP, please try again later.',
      });
      return;
    }
    
    clientData.count++;
    next();
  };
};

// General rate limiter
export const generalLimiter = createLimiter(15 * 60 * 1000, 100); // 15 minutes, 100 requests

// Strict rate limiter for sensitive endpoints
export const strictLimiter = createLimiter(15 * 60 * 1000, 5); // 15 minutes, 5 requests
