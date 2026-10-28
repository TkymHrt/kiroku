import { defineHandler } from "void";
import { database } from "../../../server/database";
import { getNoteState, mutateNote, noteErrorResponse, readNoteJson } from "../../../server/notes";
export const GET = defineHandler(async (c) => {
  try {
    return await getNoteState(database(), c.req.param("id") ?? "");
  } catch (error) {
    return noteErrorResponse(error);
  }
});
export const POST = defineHandler(async (c) => {
  try {
    return await mutateNote(database(), c.req.param("id") ?? "", await readNoteJson(c.req.raw));
  } catch (error) {
    return noteErrorResponse(error);
  }
});
