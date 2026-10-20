import { defineHandler } from "void";
import { env } from "void/env";
import { database } from "../../server/database";
import { getEpoch } from "../../server/diaries";
import { errorResponse } from "../../server/errors";
import { authenticate } from "../../server/security";

export const GET = defineHandler(async (c) => {
  try {
    return {
      authenticated: true,
      email: await authenticate(c.req.raw, env, import.meta.env.DEV),
      epoch: await getEpoch(database()),
    };
  } catch (error) {
    return errorResponse(error);
  }
});
