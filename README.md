# CDP Hackathon Backend

A robust Express.js TypeScript backend API with comprehensive middleware, routing, and error handling.

## Features

- ✅ **TypeScript** - Full TypeScript support with strict type checking
- ✅ **Express.js** - Fast, unopinionated web framework
- ✅ **Middleware Stack** - Security, logging, validation, rate limiting
- ✅ **Error Handling** - Centralized error handling with custom error types
- ✅ **API Validation** - Request validation using express-validator
- ✅ **Rate Limiting** - Protection against brute force attacks
- ✅ **CORS** - Cross-origin resource sharing configuration
- ✅ **Security** - Helmet.js for security headers
- ✅ **Logging** - Morgan for HTTP request logging
- ✅ **Health Checks** - Basic and detailed health check endpoints
- ✅ **Development Tools** - Hot reload, linting, testing setup

## Project Structure

```
src/
├── config/          # Configuration files
├── controllers/     # Route controllers
├── middleware/      # Custom middleware
├── routes/          # API routes
├── services/        # Business logic layer
├── types/           # TypeScript type definitions
├── utils/           # Utility functions
└── index.ts         # Application entry point
```

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment variables:
   ```bash
   cp .env.example .env
   ```

4. Update the `.env` file with your configuration

### Development

Start the development server with hot reload:
```bash
npm run dev
```

### Building

Build the project for production:
```bash
npm run build
```

### Running in Production

```bash
npm start
```

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the project
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues
- `npm test` - Run tests

## API Endpoints

### Health Check
- `GET /health` - Basic health check
- `GET /api/health/detailed` - Detailed health information

### Users
- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### App Endpoints (Firebase Auth Required)
- `GET /api/getAccount` - Get user account information
- `POST /api/chat` - Send chat message and get AI response
- `POST /api/topup` - Top up user account balance
- `POST /api/addTool` - Add a new tool for the user
- `POST /api/addMedia` - Add media file for the user

### API Info
- `GET /api` - API information and version

## Authentication

The app endpoints require Firebase authentication. Include the Firebase ID token in the Authorization header:

```
Authorization: Bearer <firebase-id-token>
```

In development mode, if Firebase credentials are not configured, a mock user will be used automatically.

## Middleware

The application includes several middleware layers:

1. **Security Middleware** (Helmet.js)
2. **CORS** - Cross-origin resource sharing
3. **Rate Limiting** - Request rate limiting
4. **Logging** - HTTP request logging
5. **Body Parsing** - JSON and URL-encoded data
6. **Validation** - Request validation
7. **Error Handling** - Centralized error handling

## Environment Variables

Create a `.env` file based on `.env.example`:

```env
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:3000
API_KEY=your-api-key
JWT_SECRET=your-jwt-secret
```

## License

ISC
