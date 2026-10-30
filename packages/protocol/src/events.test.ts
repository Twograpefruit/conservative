import { describe, expect, it } from 'vitest';
import {
  createChatState,
  hydrateMessages,
  reduceEvent,
  type UpstreamEvent,
} from '../src/index.js';
import type { AssistantMessage, MessageInfo, SessionInfo } from '../src/types.js';

let n = 0;
function ev(type: string, data: unknown, overrides: Partial<UpstreamEvent> = {}): UpstreamEvent {
  n += 1;
  return { id: `evt_${n}`, created: 1000 + n, type, data, ...overrides };
}

function session(id: string, title = id): SessionInfo {
  return { id, title, projectID: 'p1', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, updated: 1 } };
}

describe('event reducer', () => {
  it('ignores duplicate event ids', () => {
    let state = createChatState();
    const e = ev('session.text.delta', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 0, delta: 'hello' });
    state = reduceEvent(state, e);
    state = reduceEvent(state, e);
    expect(state.streams.m1.texts[0].text).toBe('hello');
  });

  it('accumulates text deltas and lets the final text win', () => {
    let state = createChatState();
    state = reduceEvent(state, ev('session.text.started', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 0 }));
    state = reduceEvent(state, ev('session.text.delta', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 0, delta: 'Hel' }));
    state = reduceEvent(state, ev('session.text.delta', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 0, delta: 'lo' }));
    expect(state.streams.m1.texts[0].text).toBe('Hello');
    state = reduceEvent(state, ev('session.text.ended', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 0, text: 'Hello!' }));
    expect(state.streams.m1.texts[0]).toMatchObject({ text: 'Hello!', done: true });
  });

  it('does not let an out-of-order delta clobber the final text', () => {
    let state = createChatState();
    state = reduceEvent(state, ev('session.text.ended', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 0, text: 'final' }));
    state = reduceEvent(state, ev('session.text.delta', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 0, delta: 'late' }));
    expect(state.streams.m1.texts[0].text).toBe('final');
  });

  it('tracks the tool lifecycle and keeps outputs on failure', () => {
    let state = createChatState();
    state = reduceEvent(state, ev('session.step.started', { sessionID: 's1', assistantMessageID: 'm1', agent: 'build' }));
    state = reduceEvent(state, ev('session.tool.input.started', { sessionID: 's1', assistantMessageID: 'm1', id: 't1', name: 'shell' }));
    state = reduceEvent(state, ev('session.tool.input.ended', { sessionID: 's1', assistantMessageID: 'm1', id: 't1', text: '{"command":"echo hi"}' }));
    state = reduceEvent(state, ev('session.tool.called', { sessionID: 's1', assistantMessageID: 'm1', id: 't1', input: { command: 'echo hi' } }));
    state = reduceEvent(state, ev('session.tool.success', { sessionID: 's1', assistantMessageID: 'm1', id: 't1', content: [{ type: 'text', text: 'hi' }], metadata: { exit: 0 } }));
    expect(state.streams.m1.tools.t1.status).toBe('completed');
    expect(state.streams.m1.tools.t1.input).toEqual({ command: 'echo hi' });
    expect(state.streams.m1.tools.t1.content?.[0].text).toBe('hi');

    state = reduceEvent(state, ev('session.tool.failed', { sessionID: 's1', assistantMessageID: 'm1', id: 't2', name: 'read', error: 'boom' }));
    expect(state.streams.m1.tools.t2.status).toBe('error');
    expect(state.streams.m1.tools.t2.error).toBe('boom');
  });

  it('buckets permission requests by session and removes on reply', () => {
    let state = createChatState();
    state = reduceEvent(state, ev('permission.asked', { id: 'p1', sessionID: 's1', action: 'shell', resources: ['echo'] }));
    state = reduceEvent(state, ev('permission.asked', { id: 'p2', sessionID: 's2', action: 'write', resources: ['a.py'] }));
    state = reduceEvent(state, ev('permission.asked', { id: 'p1', sessionID: 's1', action: 'shell', resources: ['echo'] }));
    expect(state.permissions.s1).toHaveLength(1);
    expect(state.permissions.s2).toHaveLength(1);
    state = reduceEvent(state, ev('permission.replied', { sessionID: 's1', requestID: 'p1', decision: 'once' }));
    expect(state.permissions.s1).toHaveLength(0);
    expect(state.permissions.s2).toHaveLength(1);
  });

  it('deletes a session together with messages, streams and permissions', () => {
    let state = createChatState();
    state = reduceEvent(state, ev('session.created', { sessionID: 's1', title: 'one' }));
    state = reduceEvent(state, ev('session.text.delta', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 0, delta: 'x' }));
    state = reduceEvent(state, ev('permission.asked', { id: 'p1', sessionID: 's1', action: 'shell', resources: [] }));
    state = hydrateMessages(state, 's1', [{ id: 'm1', type: 'assistant', time: { created: 1 }, agent: 'build', model: { id: 'x', providerID: 'y' }, content: [] }]);
    state = reduceEvent(state, ev('session.deleted', { sessionID: 's1' }));
    expect(state.sessions.s1).toBeUndefined();
    expect(state.messages.s1).toBeUndefined();
    expect(state.streams.m1).toBeUndefined();
    expect(state.permissions.s1).toBeUndefined();
    expect(state.sessionOrder).not.toContain('s1');
  });

  it('treats retry as busy rather than an error', () => {
    let state = createChatState();
    state = reduceEvent(state, ev('session.created', { sessionID: 's1', title: 'one' }));
    state = reduceEvent(state, ev('session.retry.scheduled', { sessionID: 's1', attempt: 2, message: 'rate limited' }));
    expect(state.runtime.s1.status).toBe('retry');
    expect(state.runtime.s1.error).toBeUndefined();
    state = reduceEvent(state, ev('session.execution.succeeded', { sessionID: 's1' }));
    expect(state.runtime.s1.status).toBe('idle');
  });

  it('keeps output and marks the session red on failure', () => {
    let state = createChatState();
    state = reduceEvent(state, ev('session.created', { sessionID: 's1' }));
    state = reduceEvent(state, ev('session.text.delta', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 0, delta: 'partial' }));
    state = reduceEvent(state, ev('session.execution.failed', { sessionID: 's1', error: { message: 'bad model' } }));
    expect(state.runtime.s1.status).toBe('error');
    expect(state.streams.m1.texts[0].text).toBe('partial');
  });

  it('removes a message and its stream on message.removed', () => {
    let state = createChatState();
    state = hydrateMessages(state, 's1', [
      { id: 'm1', type: 'user', time: { created: 1 }, text: 'hi' },
      { id: 'm2', type: 'assistant', time: { created: 2 }, agent: 'build', model: { id: 'x', providerID: 'y' }, content: [] },
    ] satisfies MessageInfo[]);
    state = reduceEvent(state, ev('session.text.delta', { sessionID: 's1', assistantMessageID: 'm2', ordinal: 0, delta: 'x' }));
    state = reduceEvent(state, ev('message.removed', { sessionID: 's1', messageID: 'm2' }));
    expect(state.messages.s1.m2).toBeUndefined();
    expect(state.messageOrder.s1).toEqual(['m1']);
    expect(state.streams.m2).toBeUndefined();
  });

  it('upserts sessions from session.created and sorts by update time', () => {
    let state = createChatState();
    state = reduceEvent(state, ev('session.created', { sessionID: 'a', title: 'A', time: { created: 10, updated: 10 } }));
    state = reduceEvent(state, ev('session.created', { sessionID: 'b', title: 'B', time: { created: 20, updated: 20 } }));
    expect(state.sessionOrder).toEqual(['b', 'a']);
    state = reduceEvent(state, ev('session.updated', { sessionID: 'a', title: 'A2', time: { created: 10, updated: 30 } }));
    expect(state.sessionOrder).toEqual(['a', 'b']);
    expect(state.sessions.a.title).toBe('A2');
  });

  it('hydrates fetched messages without dropping live streams', () => {
    let state = createChatState();
    state = reduceEvent(state, ev('session.text.delta', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 0, delta: 'live' }));
    const msg: AssistantMessage = {
      id: 'm1',
      type: 'assistant',
      time: { created: 1 },
      agent: 'build',
      model: { id: 'x', providerID: 'y' },
      content: [],
    };
    state = hydrateMessages(state, 's1', [msg]);
    expect(state.messages.s1.m1).toEqual(msg);
    expect(state.streams.m1.texts[0].text).toBe('live');
  });
});
