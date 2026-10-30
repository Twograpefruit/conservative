import React, { useEffect, useMemo, useRef } from 'react';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import markdownLang from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import php from 'highlight.js/lib/languages/php';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('markdown', markdownLang);
hljs.registerLanguage('md', markdownLang);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('php', php);

const escapeHtml = new MarkdownIt().utils.escapeHtml;

function highlightCode(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
    } catch {
      /* fall through */
    }
  }
  return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight: highlightCode,
});
md.use(taskLists as never, { enabled: true, label: false });

function normalizeRelative(baseFile: string, src: string): string {
  const parts = baseFile.split('/').slice(0, -1);
  for (const part of src.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}

export function MarkdownPreview({
  content,
  path,
  workspaceID,
  scrollRatio,
  onToggleTask,
}: {
  content: string;
  path: string;
  workspaceID: string | null;
  scrollRatio: number;
  onToggleTask: (index: number, checked: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const taskCount = useMemo(() => (content.match(/^\s*[-*+]\s+\[[ xX]\]/gm) ?? []).length, [content]);

  const html = useMemo(() => {
    const local = new MarkdownIt({
      html: false,
      linkify: true,
      breaks: false,
      highlight: md.options.highlight,
    });
    local.use(taskLists as never, { enabled: true, label: false });
    local.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const src = String(token.attrGet('src') ?? '');
      if (src && !/^(https?:|data:|\/|#)/i.test(src)) {
        const rel = normalizeRelative(path, src);
        token.attrSet('src', `/api/fs/raw?ws=${encodeURIComponent(workspaceID ?? '')}&path=${encodeURIComponent(rel)}`);
      }
      token.attrSet('loading', 'lazy');
      return self.renderToken(tokens, idx, options);
    };
    local.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      const href = String(tokens[idx].attrGet('href') ?? '');
      if (/^https?:/i.test(href)) {
        tokens[idx].attrSet('target', '_blank');
        tokens[idx].attrSet('rel', 'noreferrer noopener');
      }
      return self.renderToken(tokens, idx, options);
    };
    const raw = local.render(content);
    return DOMPurify.sanitize(raw, {
      ADD_TAGS: ['input'],
      ADD_ATTR: ['target', 'rel', 'loading', 'checked', 'disabled', 'type'],
    });
  }, [content, path, workspaceID]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const boxes = el.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox');
    boxes.forEach((box, i) => {
      box.dataset.taskIndex = String(i);
      box.disabled = false;
    });
  }, [html]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const max = Math.max(1, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.min(max, Math.max(0, scrollRatio * max));
  }, [scrollRatio]);

  return (
    <div
      className="markdown-preview"
      ref={host}
      onClick={(e) => {
        const target = e.target as HTMLInputElement;
        if (target.tagName === 'INPUT' && target.type === 'checkbox' && target.dataset.taskIndex) {
          onToggleTask(Number(target.dataset.taskIndex), target.checked);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
      data-task-count={taskCount}
    />
  );
}
