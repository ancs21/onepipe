/**
 * Auth Client
 *
 * Frontend client for better-auth
 */

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
});

export const { useSession, signIn, signUp, signOut } = authClient;
