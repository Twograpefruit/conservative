import type { AssistantMessage, AssistantStream, MessageInfo, ReasoningPart, TextPart, ToolPart } from '@ocg/protocol';

export interface RenderPart {
  kind: 'text' | 'reasoning' | 'tool';
  key: string;
  at: number;
  text?: string;
  done?: boolean;
  tool?: {
    id: string;
    name: string;
    status: 'streaming' | 'running' | 'completed' | 'error';
    input?: unknown;
    inputText?: string;
    content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
    metadata?: Record<string, unknown>;
    error?: string;
  };
}

function isAssistant(m: MessageInfo | undefined): m is AssistantMessage {
  return Boolean(m && (m as AssistantMessage).type === 'assistant');
}

export function renderParts(message: MessageInfo | undefined, stream: AssistantStream | undefined): RenderPart[] {
  const parts: RenderPart[] = [];
  let textOrdinal = 0;
  let reasoningOrdinal = 0;

  if (isAssistant(message)) {
    let index = 0;
    for (const part of message.content ?? []) {
      if (part.type === 'text') {
        parts.push({
          kind: 'text',
          key: `text:${textOrdinal}`,
          at: index,
          text: (part as TextPart).text,
          done: true,
        });
        textOrdinal++;
      } else if (part.type === 'reasoning') {
        parts.push({
          kind: 'reasoning',
          key: `reasoning:${reasoningOrdinal}`,
          at: index,
          text: (part as ReasoningPart).text,
          done: true,
        });
        reasoningOrdinal++;
      } else if (part.type === 'tool') {
        const tool = part as ToolPart;
        parts.push({
          kind: 'tool',
          key: `tool:${tool.id}`,
          at: index,
          tool: {
            id: tool.id,
            name: tool.name,
            status: tool.state?.status ?? 'completed',
            input: tool.state?.input,
            content: tool.state?.content,
            metadata: tool.state?.metadata,
            error: tool.state?.error,
          },
        });
      }
      index++;
    }
  }

  if (stream) {
    const textSlots = Object.values(stream.texts).sort((a, b) => a.ordinal - b.ordinal);
    for (const slot of textSlots) {
      const existing = parts.find((p) => p.key === `text:${slot.ordinal}`);
      if (existing) {
        existing.text = slot.done || slot.text.length >= (existing.text?.length ?? 0) ? slot.text : existing.text;
        existing.done = slot.done;
      } else {
        parts.push({ kind: 'text', key: `text:${slot.ordinal}`, at: 1000 + slot.at, text: slot.text, done: slot.done });
      }
    }
    const reasoningSlots = Object.values(stream.reasoning).sort((a, b) => a.ordinal - b.ordinal);
    for (const slot of reasoningSlots) {
      const existing = parts.find((p) => p.key === `reasoning:${slot.ordinal}`);
      if (existing) {
        existing.text = slot.done || slot.text.length >= (existing.text?.length ?? 0) ? slot.text : existing.text;
        existing.done = slot.done;
      } else {
        parts.push({
          kind: 'reasoning',
          key: `reasoning:${slot.ordinal}`,
          at: 1000 + slot.at,
          text: slot.text,
          done: slot.done,
        });
      }
    }
    for (const id of stream.toolOrder) {
      const tool = stream.tools[id];
      if (!tool) continue;
      const existing = parts.find((p) => p.key === `tool:${id}`);
      const merged = {
        id,
        name: tool.name,
        status: tool.status,
        input: tool.input,
        inputText: tool.inputText,
        content: tool.content,
        metadata: tool.metadata,
        error: tool.error,
      };
      if (existing) existing.tool = merged;
      else parts.push({ kind: 'tool', key: `tool:${id}`, at: 1000 + tool.at, tool: merged });
    }
    if (parts.length === 0 && textSlots.length === 0) {
      // Agent may be thinking without emitting parts yet.
      parts.push({ kind: 'text', key: 'placeholder', at: 0, text: '', done: false });
    }
  }

  return parts.sort((a, b) => a.at - b.at);
}

export function toolText(tool: NonNullable<RenderPart['tool']>): string {
  if (tool.content?.length) {
    return tool.content
      .map((c) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
      .join('\n');
  }
  if (tool.error != null) {
    return typeof tool.error === 'string' ? tool.error : JSON.stringify(tool.error);
  }
  if (tool.metadata) {
    const status = tool.metadata.status;
    const exit = tool.metadata.exit;
    if (status != null || exit != null) return `status=${String(status ?? '')} exit=${String(exit ?? '')}`;
    try {
      return JSON.stringify(tool.metadata);
    } catch {
      return String(tool.metadata);
    }
  }
  return '';
}

export function formatInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
