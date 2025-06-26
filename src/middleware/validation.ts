import { Request, Response, NextFunction } from 'express';

// Simple validation middleware without express-validator for now
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // For now, just pass through - can be enhanced with actual validation
  next();
};

// Simple validation functions
export const validateEmail = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    res.status(400).json({
      success: false,
      message: 'Please provide a valid email',
    });
    return;
  }
  next();
};

export const validatePassword = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters long',
    });
    return;
  }
  next();
};

export const validateRequired = (field: string) => (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const value = req.body[field];
  if (!value || value.trim() === '') {
    res.status(400).json({
      success: false,
      message: `${field} is required`,
    });
    return;
  }
  next();
};


