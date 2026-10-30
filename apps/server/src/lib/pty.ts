import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { WebSocket } from 'ws';
import WebSocketClient from 'ws';
import type { RuntimeHost } from '@ocg/host';
import type { PtyInfo } from '@ocg/protocol';
import type { Workspace } from '@ocg/config';
import type { UpstreamManager } from '../upstream.js';
import { HttpError } from './http.js';

interface Ticket {
  ptyID: string;
  directory: string;
  upstreamTicket: string;
  expiresAt: number;
}

export interface CreatePtyInput {
  cols?: number;
  rows?: number;
  title?: string;
  shell?: string;
}

function locQuery(directory: string): string {
  return 'location[directory]=' + encodeURIComponent(directory);
}

export class PtyService {
  private tickets = new Map<string, Ticket>();
  private sessions = new Map<string, { workspaceID: string; title: string }>();

  constructor(
    private readonly upstream: UpstreamManager,
    private readonly host: RuntimeHost,
  ) {}

  private command(ws: Workspace): { command: string; args: string[]; env: Record<string, string> } {
    const shell = process.env.COMSPEC ?? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
    const venvDir = ws.venv ? path.dirname(ws.venv) : null;
    const env: Record<string, string> = {
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      TERM: 'xterm-256color',
      ...(venvDir
        ? {
            VIRTUAL_ENV: path.dirname(venvDir),
            PATH: `${venvDir};${process.env.PATH ?? ''}`,
          }
        : {}),
    };
    return {
      command: shell,
      // Keep the startup command to one argv token: quoted scripts are fragile through ConPTY.
      args: ['/k', 'chcp 65001>nul'],
      env,
    };
  }

  async create(ws: Workspace, input: CreatePtyInput): Promise<{ id: string; ticket: string; expiresIn: number }> {
    const cmd = this.command(ws);
    const res = await this.upstream.fetch(`/api/pty?${locQuery(ws.path)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        command: cmd.command,
        args: cmd.args,
        cwd: ws.path,
        title: input.title ?? `终端 · ${ws.label}`,
        env: cmd.env,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpError(502, `failed to create upstream PTY: ${res.status} ${text.slice(0, 300)}`, 'pty_upstream');
    }
    const json = (await res.json()) as { data: { id: string } };
    const ptyID = json.data.id;
    const token = await this.upstream.fetch(`/api/pty/${encodeURIComponent(ptyID)}/connect-token?${locQuery(ws.path)}`, {
      method: 'POST',
      headers: { 'x-opencode-ticket': '1' },
    });
    if (!token.ok) {
      const text = await token.text().catch(() => '');
      throw new HttpError(502, `failed to create PTY ticket: ${token.status} ${text.slice(0, 300)}`, 'pty_ticket');
    }
    const tj = (await token.json()) as { data: { ticket: string; expires_in: number } };
    const ticket = randomUUID();
    this.tickets.set(ticket, {
      ptyID,
      directory: ws.path,
      upstreamTicket: tj.data.ticket,
      expiresAt: Date.now() + Math.min(tj.data.expires_in ?? 60, 120) * 1000,
    });
    this.sessions.set(ptyID, { workspaceID: ws.id, title: input.title ?? ws.label });
    return { id: ptyID, ticket, expiresIn: tj.data.expires_in ?? 60 };
  }

  take(ticket: string): Ticket {
    const found = this.tickets.get(ticket);
    if (!found) throw new HttpError(403, 'invalid or already used PTY ticket', 'pty_ticket');
    this.tickets.delete(ticket);
    if (Date.now() > found.expiresAt) throw new HttpError(403, 'PTY ticket expired', 'pty_ticket_expired');
    return found;
  }

  async list(ws: Workspace): Promise<PtyInfo[]> {
    const res = await this.upstream.fetch(`/api/pty?${locQuery(ws.path)}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ id: string; title?: string; cwd?: string; status?: string; pid?: number; exitCode?: number }> };
    return (json.data ?? []).map((p) => ({
      id: p.id,
      title: p.title ?? p.id,
      cwd: p.cwd ?? ws.path,
      status: p.status === 'exited' ? 'exited' : 'running',
      pid: p.pid,
      exitCode: p.exitCode,
    }));
  }

  async resize(ptyID: string, directory: string, cols: number, rows: number): Promise<void> {
    await this.upstream.fetch(`/api/pty/${encodeURIComponent(ptyID)}?${locQuery(directory)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ size: { rows: Math.max(1, rows), cols: Math.max(1, cols) } }),
    }).catch(() => undefined);
  }

  async remove(ptyID: string, directory: string): Promise<void> {
    await this.upstream.fetch(`/api/pty/${encodeURIComponent(ptyID)}?${locQuery(directory)}`, { method: 'DELETE' }).catch(() => undefined);
    this.sessions.delete(ptyID);
  }

  attach(client: WebSocket, ticket: string, cols: number, rows: number): void {
    let info: Ticket;
    try {
      info = this.take(ticket);
    } catch (err) {
      client.close(4403, err instanceof Error ? err.message : 'invalid ticket');
      return;
    }
    const url = this.upstream.wsUrl(
      `/api/pty/${encodeURIComponent(info.ptyID)}/connect?${locQuery(info.directory)}&ticket=${encodeURIComponent(info.upstreamTicket)}`,
    );
    if (!url) {
      client.close(4503, 'upstream unavailable');
      return;
    }
    const upstreamWs = new WebSocketClient(url);
    let alive = true;
    upstreamWs.on('open', () => {
      void this.resize(info.ptyID, info.directory, cols, rows);
      client.send(JSON.stringify({ type: 'ready', id: info.ptyID }));
    });
    upstreamWs.on('message', (data, isBinary) => {
      if (!alive) return;
      if (isBinary) {
        // The upstream uses binary control frames (cursor); terminal output arrives as text.
        try {
          const text = data.toString();
          const msg = JSON.parse(text) as { cursor?: number };
          client.send(JSON.stringify({ type: 'cursor', cursor: msg.cursor ?? 0 }));
        } catch {
          /* ignore */
        }
        return;
      }
      client.send(data.toString());
    });
    upstreamWs.on('close', (code, reason) => {
      alive = false;
      client.close(code === 1000 ? 1000 : 4410, reason.toString().slice(0, 100) || 'upstream closed');
    });
    upstreamWs.on('error', () => {
      if (alive) client.close(4502, 'upstream PTY error');
      alive = false;
    });
    client.on('message', (data, isBinary) => {
      if (upstreamWs.readyState !== WebSocketClient.OPEN) return;
      if (!isBinary) {
        const text = data.toString();
        try {
          const msg = JSON.parse(text) as { type?: string; cols?: number; rows?: number };
          if (msg.type === 'resize') {
            void this.resize(info.ptyID, info.directory, msg.cols ?? cols, msg.rows ?? rows);
            return;
          }
        } catch {
          /* plain input */
        }
        upstreamWs.send(text);
        return;
      }
      upstreamWs.send(data);
    });
    client.on('close', () => {
      alive = false;
      try {
        upstreamWs.close();
      } catch {
        /* noop */
      }
    });
    client.on('error', () => {
      alive = false;
      try {
        upstreamWs.terminate();
      } catch {
        /* noop */
      }
    });
  }
}
