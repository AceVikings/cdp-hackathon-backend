import { Request, Response, NextFunction } from 'express';

export const validateApiKey = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const apiKey = req.headers['x-api-key'] as string;
  const validApiKey = process.env.API_KEY;

  if (!validApiKey) {
    return next(); // Skip validation if no API key is set
  }

  if (!apiKey || apiKey !== validApiKey) {
    res.status(401).json({
      success: false,
      message: 'Invalid or missing API key',
    });
    return;
  }

  next();
};
