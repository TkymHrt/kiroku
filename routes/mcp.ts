import { defineHandler } from "void";
import { env } from "void/env";
import { database } from "../server/database";
import { handleMcp } from "../server/mcp";
import { LOCAL_MCP_SECRET } from "../server/mcp-security";
import { isLoopback } from "../server/security";

const handler = defineHandler((c) =>
  handleMcp(c.req.raw, {
    db: database(),
    secret:
      import.meta.env.DEV && isLoopback(c.req.raw) ? LOCAL_MCP_SECRET : env.MCP_CURSOR_SECRET!,
  }),
);
export const POST = handler;
export const GET = handler;
export const DELETE = handler;
