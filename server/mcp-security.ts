import { ApiError } from "./errors";
import { authenticate, isLoopback, type AccessConfig } from "./security";

export interface McpConfig extends AccessConfig {
  MCP_ORIGIN?: string;
  MCP_ACCESS_AUD?: string;
  MCP_CURSOR_SECRET?: string;
}
export const LOCAL_MCP_SECRET = "loopback-development-only-mcp-cursor-signing-key";

export async function authenticateMcp(request: Request, config: McpConfig, development: boolean) {
  const local = development && isLoopback(request);
  const url = new URL(request.url);
  if (url.search || url.hash)
    throw new ApiError(400, "INVALID_MCP_URL", "MCPにqueryは指定できません。");
  const origin = local ? url.origin : config.MCP_ORIGIN;
  if (
    !local &&
    (!origin ||
      !config.MCP_ACCESS_AUD ||
      !config.MCP_CURSOR_SECRET ||
      config.MCP_CURSOR_SECRET.length < 32)
  )
    throw new ApiError(503, "MCP_NOT_CONFIGURED", "MCP設定が必要です。");
  if (!local && (url.protocol !== "https:" || url.origin !== origin))
    throw new ApiError(403, "MCP_HOST_REJECTED", "MCPホストが一致しません。");
  const host = request.headers.get("host");
  if (host && host !== url.host)
    throw new ApiError(403, "MCP_HOST_REJECTED", "Hostが一致しません。");
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== origin && requestOrigin !== "https://chatgpt.com")
    throw new ApiError(403, "MCP_ORIGIN_REJECTED", "送信元を確認できません。");
  // Managed OAuth consumes Authorization at the edge and forwards a signed
  // Cf-Access-Jwt-Assertion instead (verified on a real Access-protected Worker).
  // Browser requests carry Sec-Fetch-Site, including same-origin cookie writes;
  // those must use the browser API's CSRF contract, never this endpoint.
  if (!local && request.headers.has("sec-fetch-site"))
    throw new ApiError(403, "MCP_BROWSER_REJECTED", "ブラウザAPIを使用してください。");
  await authenticate(request, { ...config, ACCESS_AUD: config.MCP_ACCESS_AUD }, development);
  return local ? LOCAL_MCP_SECRET : config.MCP_CURSOR_SECRET!;
}
