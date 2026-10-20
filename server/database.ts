import { env } from "cloudflare:workers";

// A primary-first session is essential for version checks and recovery epochs.
// Void's default session can start on a lagging read replica.
export function database(): D1DatabaseSession {
  return env.DB.withSession("first-primary");
}
