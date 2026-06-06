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
import helmet from "helmet";
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
  const isProd = process.env.NODE_ENV === "production";

  // FIX #1: Trust Render's reverse proxy so req.protocol === 'https' in production
  // This is required for secure session cookies to work on Render
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    if (['TRACE', 'TRACK'].includes(req.method)) {
      return res.status(405).send('Method Not Allowed');
    }
    next();
  });

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'", "https://wa.me", "https://www.paypal.com", "https://paypal.me"],
        "frame-ancestors": ["'none'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "script-src-attr": ["'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "font-src": ["'self'", "data:"],
        "connect-src": ["'self'", "https:"],
        ...(isProd ? { "upgrade-insecure-requests": [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: isProd ? { maxAge: 15552000, includeSubDomains: true, preload: false } : false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }));

  // Keep JSON forms small. Product images are uploaded through multer with its own limits.
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
  app.use(express.urlencoded({ limit: process.env.URLENCODED_BODY_LIMIT || "200kb", extended: true }));
  app.use(cookieParser());

  const configuredOrigins = (process.env.CORS_ORIGIN || process.env.PUBLIC_URL || "https://resal-store-om.onrender.com")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
  const devOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
  const allowedOrigins = new Set([...configuredOrigins, ...devOrigins]);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }));

  // Serve uploaded files
  const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'public/uploads');
  app.use('/uploads', express.static(uploadDir, {
    fallthrough: false,
    maxAge: isProd ? '7d' : 0,
  }));

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

  app.get('/admin.html', (req, res) => {
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
