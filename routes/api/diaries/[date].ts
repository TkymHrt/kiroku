import { defineHandler } from "void";
import { database } from "../../../server/database";
import { getDiaryState, mutateDiary } from "../../../server/diaries";
import { errorResponse } from "../../../server/errors";
import { readMutation } from "../../../server/validation";

export const GET = defineHandler(async (c) => {
  try {
    const db = database();
    return await getDiaryState(db, c.req.param("date") ?? "");
  } catch (error) {
    return errorResponse(error);
  }
});

export const POST = defineHandler(async (c) => {
  try {
    return await mutateDiary(database(), c.req.param("date") ?? "", await readMutation(c.req.raw));
  } catch (error) {
    return errorResponse(error);
  }
});
