import { useEffect, useRef, useState } from 'react';
import { tr } from '../lib/i18n';
import type { ChatMessage } from '../lib/types';
import { atBottom, lastReasoningLine, thoughtDuration } from '../lib/reasoning';
import { Icon } from './ui';

/**
 * One stretch of the model's thinking, drawn where it happened: closed by default; while it is live the row says what the
 * model is thinking about, afterwards "Thought for 38s" or just "Reasoning". Opened, it is a short muted box that follows
 * the newest line unless the person scrolls up.
 */
export function ReasoningSegment({ text, live, tookMs }: { text: string; live: boolean; tookMs?: number }) {
  const body = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [stick, setStick] = useState(true);
  useEffect(() => { if (open && stick && body.current) body.current.scrollTop = body.current.scrollHeight; }, [text, open, stick]);
  useEffect(() => { if (open) { setStick(true); requestAnimationFrame(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight; }); } }, [open]);
  const took = thoughtDuration(tookMs);
  const label = live ? lastReasoningLine(text) || tr('Thinking…') : took ? tr('Thought for {0}', [took]) : tr('Reasoning');
  return <details className="rz" open={open} data-live={live || undefined} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><Icon name="thinking" size={14}/><span className="rz__label">{label}</span><Icon name="chevron" size={12} className="rz__chev"/></summary>
    <div className="rz__body" ref={body} tabIndex={0} aria-label={tr('Model reasoning')} onScroll={e => setStick(atBottom(e.currentTarget))}>{text}</div>
    {open && live && !stick ? <button type="button" className="rz__jump" onClick={() => { setStick(true); }}><Icon name="chevron" size={11}/>{tr('Jump to latest')}</button> : null}
  </details>;
}

/** The whole thinking of a reply that carries no thinking in its flow: an older chat, or a turn taken over (`resync`). */
export function ReasoningBlock({ message }: { message: ChatMessage }) {
  return <ReasoningSegment text={message.reasoning ?? ''} live={!!message.streaming && message.reasoningMs === undefined && !message.content} tookMs={message.reasoningMs}/>;
}
