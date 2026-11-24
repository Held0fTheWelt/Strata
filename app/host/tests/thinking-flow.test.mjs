/**
 * The owner's report: thinking is a piece of the reply, not a window pinned above it. A turn that thinks, works, thinks again and
 * answers keeps that order in `blocks`, so the thinking row appears where the model thought and the answer text where it wrote.
 * A reply whose thinking arrived as one whole string (a taken-over turn, an older chat) keeps the single block above.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatStore } from '../server/chat-store.mjs';
import { installFakeHostFetch } from './helpers/fake-host-chats.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
async function bundle(entry, plugins = []) {
  const result = await build({
    entryPoints: [here(entry)], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    alias: { react: here('./helpers/react-stub.mjs') }, loader: { '.json': 'json' }, plugins,
  });
  // A different text each time: the same text would give the same module, with the first test's state in it.
  return import(`data:text/javascript;base64,${Buffer.from(`${result.outputFiles[0].text}
// ${Math.random()}`).toString('base64')}`);
}

function pageGlobals() {
  globalThis.window ??= globalThis;
  globalThis.document ??= { addEventListener() {}, hasFocus: () => true, visibilityState: 'visible', documentElement: { dataset: {}, style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} } } };
  const memory = new Map();
  globalThis.localStorage = {
    get length() { return memory.size; },
    key: (i) => [...memory.keys()][i] ?? null,
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => { memory.set(k, v); },
    removeItem: (k) => memory.delete(k),
  };
  globalThis.navigator ??= { language: 'en' };
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.__streams = [];
}

const mockClient = {
  name: 'mock-client',
  setup(b) {
    b.onResolve({ filter: /\/client$/ }, () => ({ path: 'mock-client', namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
      loader: 'js',
      contents: `
        export class ApiError extends Error {}
        const reject = async () => { throw new Error('offline'); };
        export const api = { get: reject, post: async () => ({}), put: reject, patch: reject, del: reject, delete: reject };
        export function onEvent() { return () => {}; }
        export async function streamPost(path, body, onFrame) {
          await new Promise((release) => globalThis.__streams.push({ path, body, onFrame, release }));
        }`,
    }));
  },
};

const wait = async (n) => { for (let i = 0; i < 200 && globalThis.__streams.length < n; i++) await new Promise((r) => setTimeout(r, 5)); assert.ok(globalThis.__streams.length >= n, `stream ${n} started`); };

test('thinking, work and the answer keep their order inside one reply', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-thinking-flow-'));
  const chatStore = createChatStore({ dir });
  const fakeHost = installFakeHostFetch(chatStore);
  try {
    pageGlobals();
    const store = await bundle('../src/lib/store.ts', [mockClient]);
    await store.loadChatsFromHost();
    const session = store.newSession();
    const turn = store.sendMessage('do the thing');
    await wait(1);
    const s = globalThis.__streams[0];
    assert.equal(s.path, '/api/chat/stream');
    s.onFrame({ type: 'start', model: 'm', contextMax: 8192, requestId: 'r1', agent: true });
    s.onFrame({ type: 'status', seq: 1, phase: 'thinking', code: 'thinking', text: 'Thinking… 4 tokens', tokens: 4 });
    s.onFrame({ type: 'reasoning', text: 'First I look. ' });
    s.onFrame({ type: 'activity-group', id: 'g1', closed: true, line: 'Ran 2 commands', files: [], added: 0, removed: 0 });
    s.onFrame({ type: 'status', seq: 2, phase: 'thinking', code: 'thinking', text: 'Thinking… 3 tokens', tokens: 3 });
    s.onFrame({ type: 'reasoning', text: 'Now I answer. ' });
    s.onFrame({ type: 'delta', text: 'Done.' });
    s.onFrame({ type: 'done', tokensIn: 1, tokensOut: 2, durationMs: 500, usageSource: 'reported' });
    s.release();          // the stream ends: the page's side of the turn finishes with it
    await turn;

    const msg = store.getState().sessions.find((x) => x.id === session.id).messages.at(-1);
    assert.deepEqual(msg.blocks.map((b) => b.kind), ['reasoning', 'group', 'reasoning', 'text'],
      `the reply came as ${JSON.stringify(msg.blocks.map((b) => b.kind))}`);
    assert.equal(msg.blocks[0].text, 'First I look. ', 'the first stretch of thinking sits before the work');
    assert.equal(msg.blocks[2].text, 'Now I answer. ', 'the second stretch sits behind the work line');
    assert.equal(msg.blocks[3].text, 'Done.', 'the answer is the last piece');
    assert.equal(msg.content, 'Done.', 'the reply text stays the whole answer (copying and exporting work as before)');
    assert.equal(msg.reasoning, 'First I look. Now I answer. ', 'the turn keeps its thinking as one string aside');
  } finally {
    fakeHost.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a reply taken over without thinking pieces gets the thinking back as one piece before its text', async () => {
  const { appendReasoning, appendText } = await bundle('../src/lib/deliverables.ts');
  assert.deepEqual(appendReasoning(undefined, 'Think. ').map((b) => b.kind), ['reasoning']);
  const afterWork = appendReasoning(appendText(undefined, 'Answer. '), 'More thinking. ');
  assert.deepEqual(afterWork.map((b) => b.kind), ['text', 'reasoning'], 'thinking opens behind the text it came after');
  assert.equal(appendReasoning(afterWork, ' and on. ')[1].text, 'More thinking.  and on. ', 'a second piece goes on in the stretch it follows');
  assert.deepEqual(appendReasoning(undefined, '').map((b) => b.kind), ['reasoning'], 'a stretch that has started but said nothing is a piece too');
});
