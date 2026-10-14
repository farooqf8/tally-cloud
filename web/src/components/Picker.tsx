// Type-ahead list selector, like Tally's "List of Ledger Accounts". Typing filters, arrows move,
// Enter/Tab picks and advances to the next field, Esc closes the list.
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { focusNext } from '../lib/keys';

export interface Option { id: number | string; label: string; sub?: string; right?: string }

interface Props {
  value: number | string | null | undefined;
  options: Option[];
  onChange: (id: any) => void;
  title?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Adds "End of List" at the top; picking it calls onEnd (used to finish a table of lines). */
  onEnd?: () => void;
  onCreate?: (text: string) => void;
  className?: string;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

const END = '__end__';
const CREATE = '__create__';

export function Picker({ value, options, onChange, title, placeholder, autoFocus, onEnd, onCreate, className, disabled, inputRef }: Props) {
  const selected = options.find((o) => o.id === value);
  const [text, setText] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  const listRef = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState(false);
  // Arrow keys moved the highlight away from the current value.
  const moved = useRef(false);

  useEffect(() => { if (!open) setText(selected?.label ?? ''); }, [selected?.label, open]);

  const filtered = useMemo(() => {
    const q = typed ? text.trim().toLowerCase() : '';
    const list = q
      ? [...options.filter((o) => o.label.toLowerCase().startsWith(q)), ...options.filter((o) => !o.label.toLowerCase().startsWith(q) && (o.label.toLowerCase().includes(q) || o.sub?.toLowerCase().includes(q)))]
      : options;
    const extra: Option[] = [];
    if (onEnd) extra.push({ id: END, label: 'End of List' });
    if (onCreate && q && !options.some((o) => o.label.toLowerCase() === q)) extra.push({ id: CREATE, label: `Create "${text.trim()}"` });
    return [...extra, ...list];
  }, [options, text, typed, onEnd, onCreate]);

  useEffect(() => {
    if (!open) return;
    const idx = typed ? filtered.findIndex((o) => o.id !== END && o.id !== CREATE) : filtered.findIndex((o) => o.id === value);
    setHi(idx >= 0 ? idx : 0);
  }, [open, filtered, typed, value]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const pick = (o: Option | undefined) => {
    setOpen(false);
    setTyped(false);
    if (!o) return;
    if (o.id === END) { onEnd?.(); return; }
    if (o.id === CREATE) { onCreate?.(text.trim()); return; }
    // Commit synchronously so the next field (often enabled by this choice) exists before focus moves.
    flushSync(() => { onChange(o.id); setText(o.label); });
    const el = ref.current;
    if (el) focusNext(el);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.altKey) return;
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); e.preventDefault(); return; }
    if (!open) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key.startsWith('Arrow') || e.key.startsWith('Page')) moved.current = true;
    if (e.key === 'ArrowDown') { stop(); setHi((h) => Math.min(filtered.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { stop(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'PageDown') { stop(); setHi((h) => Math.min(filtered.length - 1, h + 10)); }
    else if (e.key === 'PageUp') { stop(); setHi((h) => Math.max(0, h - 10)); }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      stop();
      // Enter on an untouched field that already has a value keeps it.
      if (!typed && !moved.current && selected) pick(selected);
      else pick(filtered[hi]);
    } else if (e.key === 'Escape') { stop(); setOpen(false); setTyped(false); setText(selected?.label ?? ''); }
  };

  return (
    <div className={`relative ${className ?? ''}`}>
      <input
        ref={ref}
        className="tin"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onFocus={(e) => { moved.current = false; setOpen(true); e.target.select(); }}
        onBlur={() => setTimeout(() => { setOpen(false); setTyped(false); }, 120)}
        onChange={(e) => { setText(e.target.value); setTyped(true); setOpen(true); }}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {open && !disabled && (
        <div className="absolute z-40 left-0 top-full mt-0.5 w-[min(28rem,90vw)] bg-panel border border-brand shadow-lg">
          {title && <div className="bg-brand text-white text-xs font-semibold px-2 py-1">{title}</div>}
          <div ref={listRef} className="max-h-72 overflow-auto scroll-thin">
            {filtered.length === 0 && <div className="px-2 py-1.5 text-muted text-sm">No matches</div>}
            {filtered.map((o, i) => (
              <div
                key={String(o.id)}
                data-i={i}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                onMouseEnter={() => setHi(i)}
                className={`flex items-baseline gap-2 px-2 py-0.5 cursor-pointer text-sm ${i === hi ? 'row-sel' : ''} ${o.id === END || o.id === CREATE ? 'italic text-brand font-medium border-b border-line' : ''}`}
              >
                <span className="flex-1 truncate">{o.label}</span>
                {o.sub && <span className="text-xs text-muted truncate max-w-[45%]">{o.sub}</span>}
                {o.right && <span className="num text-xs">{o.right}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
