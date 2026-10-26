import { defineMiddleware } from "void";
import { env } from "void/env";
import { errorResponse } from "../server/errors";
import { assertCsrf, authenticate, securityHeaders } from "../server/security";
import { authenticateMcp } from "../server/mcp-security";

export default defineMiddleware(async (c, next) => {
  try {
    if (new URL(c.req.url).pathname === "/mcp") {
      await authenticateMcp(c.req.raw, env, import.meta.env.DEV);
    } else {
      await authenticate(c.req.raw, env, import.meta.env.DEV);
      assertCsrf(c.req.raw);
    }
    await next();
  } catch (error) {
    c.res = errorResponse(error);
  }
  securityHeaders(c.res.headers, import.meta.env.DEV);
});
