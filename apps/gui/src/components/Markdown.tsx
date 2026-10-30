import React from 'react';

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) nodes.push(<code key={`${keyPrefix}-c${i++}`}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) nodes.push(<strong key={`${keyPrefix}-b${i++}`}>{m[2].slice(2, -2)}</strong>);
    else if (m[3]) {
      nodes.push(
        <a key={`${keyPrefix}-a${i++}`} href={m[3]} target="_blank" rel="noreferrer">
          {m[3]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  if (!text) return null;
  const blocks: React.ReactNode[] = [];
  const parts = text.split(/```/);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const nl = part.indexOf('\n');
      const lang = nl > 0 ? part.slice(0, nl).trim() : '';
      const code = nl >= 0 ? part.slice(nl + 1) : part;
      blocks.push(
        <pre className="code-block" key={`code-${index}`} data-lang={lang}>
          <code>{code.replace(/\n$/, '')}</code>
        </pre>,
      );
    } else if (part.trim()) {
      const paragraphs = part.split(/\n{2,}/);
      paragraphs.forEach((para, pi) => {
        const lines = para.split('\n');
        blocks.push(
          <p key={`p-${index}-${pi}`} className="md-p">
            {lines.map((line, li) => (
              <React.Fragment key={li}>
                {inline(line, `${index}-${pi}-${li}`)}
                {li < lines.length - 1 ? <br /> : null}
              </React.Fragment>
            ))}
          </p>,
        );
      });
    }
  });
  return <div className="markdown">{blocks}</div>;
}
