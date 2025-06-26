import mongoose from "mongoose";

const connectDB = async (): Promise<void> => {
  try {
    const mongoURI =
      process.env.MONGODB_URI || "mongodb://localhost:27017/cdp-hackathon";

    await mongoose.connect(mongoURI);
    console.log("✅ MongoDB connected successfully");
    console.log(`📁 Database: ${mongoose.connection.name}`);
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    console.log("⚠️  Running without database - some features may not work");
    // Don't exit the process, continue without database for now
  }
};

export default connectDB;
