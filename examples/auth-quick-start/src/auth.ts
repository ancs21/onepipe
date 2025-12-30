/**
 * Auth Setup
 *
 * OnePipe Auth wrapper around better-auth
 * Stateless sessions (no database required)
 */

import { betterAuth } from "better-auth";
import { Auth, type AuthUser } from "@onepipe/sdk";

const port = process.env.PORT || 3001;

// 1. Create better-auth instance (stateless mode)
const betterAuthInstance = betterAuth({
  baseURL: `http://localhost:${port}`,
  secret: process.env.BETTER_AUTH_SECRET || "dev-secret-change-in-production-32chars",

  // Email/password auth
  emailAndPassword: {
    enabled: true,
  },

  // Stateless session - no database required
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 7 * 24 * 60 * 60, // 7 days
      strategy: "jwt",
    },
  },

  // Store account info in cookies (stateless)
  account: {
    storeStateStrategy: "cookie",
    storeAccountCookie: true,
  },
});

// 2. Custom user type
export interface AppUser extends AuthUser {
  id: string;
  email: string;
  name?: string;
  role: "admin" | "user";
}

// 3. Wrap with OnePipe Auth
export const auth = Auth.create("main")
  .provider(betterAuthInstance)
  .mapUser<AppUser>((session) => ({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? undefined,
    role: (session.user.role as "admin" | "user") || "user",
  }))
  .build();

// Export raw better-auth for handler
export { betterAuthInstance };
