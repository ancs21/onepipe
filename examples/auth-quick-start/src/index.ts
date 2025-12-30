import { serve } from "@onepipe/runtime";
import index from "./index.html";
import { REST, APIError, Log } from "@onepipe/sdk";
import { auth, type AppUser } from "./auth";

// Setup structured logging
const logger = Log.create("auth-app").console().build();

// Create protected REST API with full observability
const api = REST.create("api")
  .basePath("/api")
  .auth(auth)
  .trace()   // Distributed tracing (OTEL)
  .metrics() // RED metrics (auto: http_requests_total, http_request_duration_seconds)
  // Public routes
  .get("/health", { public: true }, async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }))
  // Protected routes
  .get("/me", async (ctx) => {
    const user = ctx.user as AppUser;
    logger.info("User profile accessed", { userId: user.id });
    return { user };
  })
  .get("/admin", async (ctx) => {
    const user = ctx.user as AppUser;
    if (user.role !== "admin") {
      logger.warn("Admin access denied", { userId: user.id, role: user.role });
      throw APIError.permissionDenied("Admin access required");
    }
    logger.info("Admin access granted", { userId: user.id });
    return { message: "Welcome admin!", user };
  })
  .build();

logger.info("Starting auth-quick-start", { port: 3001 });

// Start server using OnePipe runtime
serve({
  port: 3001,
  rest: [api],
  auth,
  html: index,
});
