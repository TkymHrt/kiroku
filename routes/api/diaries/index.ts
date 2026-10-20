import { defineHandler } from "void";
import { database } from "../../../server/database";
import { listDiaries } from "../../../server/diaries";
import { ApiError, errorResponse } from "../../../server/errors";

export const GET = defineHandler(async (c) => {
  try {
    const trash = c.req.query("trash");
    if (trash !== undefined && trash !== "0" && trash !== "1")
      throw new ApiError(400, "INVALID_INPUT", "ゴミ箱の指定が正しくありません。");
    const limit = c.req.query("limit");
    return await listDiaries(database(), {
      trash: trash === "1",
      before: c.req.query("before"),
      limit: limit === undefined ? undefined : Number(limit),
    });
  } catch (error) {
    return errorResponse(error);
  }
});
