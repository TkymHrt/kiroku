import { defineHandler } from "void";
import { database } from "../../../server/database";
import { listNotes, noteErrorResponse, readNoteJson } from "../../../server/notes";
export const POST = defineHandler(async (c) => {
  try {
    return await listNotes(database(), await readNoteJson(c.req.raw));
  } catch (error) {
    return noteErrorResponse(error);
  }
});
