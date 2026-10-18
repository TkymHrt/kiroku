import { defineHandler } from 'void';
import { database } from '../../server/database';
import { getExportPage } from '../../server/diaries';
import { errorResponse } from '../../server/errors';

export const GET = defineHandler(async (c) => {
  try { return await getExportPage(database(), c.req.query('after'), c.req.query('snapshotToken')); }
  catch (error) { return errorResponse(error); }
});
