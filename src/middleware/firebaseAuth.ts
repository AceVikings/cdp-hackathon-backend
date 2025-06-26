import admin from "firebase-admin";
import { Request, Response, NextFunction } from "express";
import { config } from "../config/index.js";

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  const firebaseConfig: any = {};

  if (
    config.firebase.projectId &&
    config.firebase.clientEmail &&
    config.firebase.privateKey
  ) {
    firebaseConfig.credential = admin.credential.cert({
      projectId: config.firebase.projectId,
      clientEmail: config.firebase.clientEmail,
      privateKey: config.firebase.privateKey,
    });
    firebaseConfig.projectId = config.firebase.projectId;
  } else {
    // For development, you can use the Firebase emulator or skip initialization
    console.warn(
      "Firebase credentials not found. Authentication will be mocked in development mode."
    );
  }

  if (Object.keys(firebaseConfig).length > 0) {
    admin.initializeApp(firebaseConfig);
  }
}

export interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken;
}

export const firebaseAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // In development mode, if Firebase is not configured, allow requests with mock user
    if (config.nodeEnv === "development" && !admin.apps.length) {
      req.user = {
        uid: "dev-user-123",
        email: "dev@example.com",
        aud: "mock",
        auth_time: Date.now() / 1000,
        exp: Date.now() / 1000 + 3600,
        firebase: {
          identities: {},
          sign_in_provider: "mock",
        },
        iat: Date.now() / 1000,
        iss: "mock",
        sub: "dev-user-123",
      };
      next();
      return;
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        message: "No authorization token provided",
      });
      return;
    }

    const token = authHeader.split("Bearer ")[1];

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Invalid authorization format",
      });
      return;
    }

    try {
      // Verify the Firebase ID token
      const decodedToken = await admin.auth().verifyIdToken(token);
      req.user = decodedToken;
      next();
    } catch (error) {
      console.error("Firebase auth error:", error);
      res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
      return;
    }
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({
      success: false,
      message: "Internal authentication error",
    });
    return;
  }
};
