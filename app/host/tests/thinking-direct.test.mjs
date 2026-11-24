import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* The direct chat path (no agent): the composer's Reasoning effort menu reaches the server as reasoning_effort ("Off" -> "none", which the
   server turns into enable_thinking=false), and the Thinking budget as reasoning_budget_tokens, never when thinking is off. */
const host = readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
const composer = readFileSync(new URL('../src/components/ComposerControls.tsx', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/lib/store.ts', import.meta.url), 'utf8');

test('Off is sent as none and Max as high for Qwen (Max as max for Hy4-Flash); the budget only with thinking on', () => {
  assert.match(host, /\(\{off:'none',max:'high'\}\[String\(thinking\)\.toLowerCase\(\)\]/);
  assert.match(host, /\(\{off:'none',minimal:'high',low:'high',medium:'high',high:'high',max:'max'\}\[String\(thinking\)\.toLowerCase\(\)\]/);
  assert.match(host, /thinkingBudget>0&&String\(thinking\)\.toLowerCase\(\)!=='off'\?\{reasoning_budget_tokens:thinkingBudget\}/);
});

test('the budget travels from the menu to the request', () => {
  assert.match(composer, /THINKING_BUDGETS/);
  assert.match(composer, /thinkingBudget: value/);
  assert.match(store, /thinkingBudget:state\.sessions\.find/);
  assert.match(host, /thinkingBudget:Number\.isInteger\(body\.thinkingBudget\)/);
});

/* The owner's report: the Thinking row and the work log were missing while a turn worked. */
const chat = readFileSync(new URL('../src/screens/Chat.tsx', import.meta.url), 'utf8');
const status = readFileSync(new URL('../server/agent/status.mjs', import.meta.url), 'utf8');

test('thinking is drawn inside the reply, in the order it came; only a reply with no thinking piece pins one block above', () => {
  assert.match(chat, /m\.reasoning && !m\.blocks\?\.some\(b => b\.kind === 'reasoning'\) \? <ReasoningBlock message=\{m\}/);
  assert.match(chat, /<ReasoningSegment key=\{`rz\$\{i\}`\} text=\{b\.text\} live=\{!!\(m\.streaming && isLast && i === m\.blocks!\.length - 1\)}/);
  assert.match(chat, /const grouped = !!m\.blocks\?\.some\(b => b\.kind === 'group' \|\| b\.kind === 'reasoning'\);/);
  assert.match(store, /blocks: appendReasoning\(m\.blocks \?\? \(m\.content \? appendText\(undefined, m\.content\) : undefined\), text\)/);
  assert.match(store, /if \(frame\.phase === 'thinking'\) patchAssistant\(m => \(m\.blocks\?\.at\(-1\)\?\.kind === 'reasoning' \? m :/);
});

test('the work log and its activity lines are drawn while a tool runs, not only after the answer', () => {
  assert.match(chat, /m\.activity\?\.length \|\| !!m\.blocks\?\.length \|\| !m\.streaming \|\| !liveStatus \|\| !!m\.drafts\?\.length/);
});

test('a silent turn beats: the status line says the time it has been going', () => {
  assert.match(status, /silentMs = silentInterval\(\)/);
  assert.match(status, /STRATA_STATUS_SILENT_MS/);
  assert.match(status, /if \(this\.silentMs > 0\) this\.#armSilent\(\);/);
  assert.match(status, /text: `\$\{c\.text\} \(\$\{fmtSeconds\(secs\)\}\)`/);
});
