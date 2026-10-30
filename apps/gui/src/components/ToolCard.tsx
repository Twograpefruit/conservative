import React, { useState } from 'react';
import { formatInput, toolText, type RenderPart } from '../lib/parts.js';

const statusLabel: Record<string, string> = {
  streaming: '准备中',
  running: '运行中',
  completed: '完成',
  error: '失败',
};

export function ToolCard({ tool }: { tool: NonNullable<RenderPart['tool']> }) {
  const [open, setOpen] = useState(tool.status === 'error');
  const output = toolText(tool);
  const input = tool.input != null ? formatInput(tool.input) : tool.inputText;
  return (
    <div className={`tool-card tool-${tool.status}`}>
      <button className="tool-head" onClick={() => setOpen((v) => !v)}>
        <span className={`tool-dot tool-dot-${tool.status}`} />
        <span className="tool-name">{tool.name}</span>
        <span className="tool-status">{statusLabel[tool.status] ?? tool.status}</span>
        <span className="tool-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className="tool-body">
          {input ? (
            <div className="tool-section">
              <div className="tool-label">输入</div>
              <pre className="tool-pre">{input}</pre>
            </div>
          ) : null}
          {output ? (
            <div className="tool-section">
              <div className="tool-label">输出</div>
              <pre className="tool-pre">{output.slice(0, 20000)}</pre>
            </div>
          ) : null}
          {tool.metadata && Object.keys(tool.metadata).length ? (
            <div className="tool-meta">
              {Object.entries(tool.metadata)
                .slice(0, 6)
                .map(([k, v]) => (
                  <span key={k}>
                    {k}: {String(v).slice(0, 80)}
                  </span>
                ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
