import { defineHandler } from "void";
import { database } from "../../../../server/database";
import { getNeighbors } from "../../../../server/diaries";
import { errorResponse } from "../../../../server/errors";

export const GET = defineHandler(async (c) => {
  try {
    return await getNeighbors(database(), c.req.param("date") ?? "");
  } catch (error) {
    return errorResponse(error);
  }
});
