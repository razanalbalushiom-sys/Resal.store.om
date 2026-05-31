import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";
import fs from "fs";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const { initializeAPI } = _require("../api.cjs");

// Note: Supabase credentials are loaded from environment variables
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // Note: Database tables and seeding are now handled in Supabase
  // The Supabase client will connect using SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
  
  const app = express();
  const server = createServer(app);

  // FIX #1: Trust Render's reverse proxy so req.protocol === 'https' in production
  // This is required for secure session cookies to work on Render
  app.set('trust proxy', 1);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(cookieParser());
  app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));

  // Serve uploaded files
  const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'public/uploads');
  app.use('/uploads', express.static(uploadDir));

  // Mount the custom Resal REST API with Supabase (with session fix applied inside)
  const resalApiRouter = await initializeAPI();
  app.use('/api', resalApiRouter);

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Serve the static HTML files (index.html, admin.html, reset-password.html)
  const staticDir = path.resolve(process.cwd(), 'public');
  
  // Direct route for root path
  app.get('/', (req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'public/index.html'));
  });
  
  app.use(express.static(staticDir));
  
  // Note: Supabase handles persistence automatically

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    // In production, just serve static files (no Vite)
    // Static files are already set up above
  }

  // Fallback route to serve index.html for SPA (for client-side routing)
  app.get('*', (req, res) => {
    const indexPath = path.resolve(process.cwd(), 'public/index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Not found');
    }
  });

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  
  console.log('[Resal] Connected to Supabase database');

  server.listen(port, "0.0.0.0", () => {
    console.log(`[Resal] Server running on http://localhost:${port}`);
  });

  return server;
}

export default startServer();
