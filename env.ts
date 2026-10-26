import { defineEnv, string } from "void/env";

// Optional for loopback development only. Middleware fails closed in production
// unless all three values are configured as Void production secrets.
export default defineEnv({
  ACCESS_TEAM_DOMAIN: string().optional(),
  ACCESS_AUD: string().optional(),
  ACCESS_EMAIL: string().optional(),
  MCP_ORIGIN: string().optional(),
  MCP_ACCESS_AUD: string().optional(),
  MCP_CURSOR_SECRET: string().optional(),
});
