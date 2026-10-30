import type { AppContext } from '../context.js';
import { HttpError } from './http.js';

export function workspaceOf(ctx: AppContext, value: unknown) {
  const ws = ctx.workspaces.get(typeof value === 'string' ? value : undefined);
  if (!ws) throw new HttpError(404, 'workspace not found', 'workspace_not_found');
  return ws;
}
