import path from 'node:path';
import type { RuntimeHost } from '@ocg/host';
import type { LintDiagnostic } from '@ocg/protocol';
import type { Workspace, Settings } from '@ocg/config';

interface PyrightJson {
  generalDiagnostics?: Array<{
    file: string;
    severity: string;
    message: string;
    range?: { start?: { line: number; character: number }; end?: { line: number; character: number } };
    rule?: string;
  }>;
}

interface RuffJson {
  code?: string;
  message: string;
  filename: string;
  location?: { row: number; column: number };
  end_location?: { row: number; column: number };
}

function severity(value: string): LintDiagnostic['severity'] {
  switch (value.toLowerCase()) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'information':
    case 'info':
      return 'information';
    default:
      return 'hint';
  }
}

export async function lintFiles(
  host: RuntimeHost,
  ws: Workspace,
  settings: Settings,
  files: string[],
): Promise<LintDiagnostic[]> {
  if (!settings.lint.enabled || files.length === 0) return [];
  const absFiles = files.map((f) => (path.isAbsolute(f) ? f : path.join(ws.path, f)));
  const rel = (f: string) => path.relative(ws.path, f).replace(/\\/g, '/');
  const out: LintDiagnostic[] = [];

  const pyright = await host.which(settings.lint.pyrightCommand);
  if (pyright) {
    const res = await host.exec(pyright, ['--outputjson', ...absFiles], {
      cwd: ws.path,
      timeoutMs: 60_000,
      env: { PYTHONUTF8: '1' },
    });
    try {
      const json = JSON.parse(res.out || res.err) as PyrightJson;
      for (const d of json.generalDiagnostics ?? []) {
        out.push({
          file: rel(d.file),
          line: (d.range?.start?.line ?? 0) + 1,
          column: (d.range?.start?.character ?? 0) + 1,
          endLine: (d.range?.end?.line ?? 0) + 1,
          endColumn: (d.range?.end?.character ?? 0) + 1,
          severity: severity(d.severity),
          message: d.message,
          source: 'pyright',
          code: d.rule,
        });
      }
    } catch {
      out.push({
        file: rel(absFiles[0]),
        line: 1,
        column: 1,
        severity: 'warning',
        message: `pyright output could not be parsed: ${(res.err || res.out).slice(0, 300)}`,
        source: 'pyright',
      });
    }
  } else {
    out.push({
      file: rel(absFiles[0]),
      line: 1,
      column: 1,
      severity: 'warning',
      message: `pyright not found (${settings.lint.pyrightCommand}); editor diagnostics disabled`,
      source: 'pyright',
    });
  }

  if (settings.lint.ruffCommand) {
    const ruff = await host.which(settings.lint.ruffCommand);
    if (ruff) {
      const res = await host.exec(ruff, ['check', '--output-format=json', '--no-fix', ...absFiles], {
        cwd: ws.path,
        timeoutMs: 30_000,
      });
      try {
        const json = JSON.parse(res.out || '[]') as RuffJson[];
        for (const d of json) {
          out.push({
            file: rel(d.filename),
            line: d.location?.row ?? 1,
            column: d.location?.column ?? 1,
            endLine: d.end_location?.row,
            endColumn: d.end_location?.column,
            severity: 'warning',
            message: d.message,
            source: 'ruff',
            code: d.code,
          });
        }
      } catch {
        /* ruff not available or emitted no JSON */
      }
    }
  }

  return out;
}
