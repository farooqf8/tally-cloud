import { useMemo } from 'react';
import { useKeys } from '../lib/keys';
import { useListNav } from './ui';

export interface MenuItem { label: string; hotkey?: string; run: () => void; hint?: string }
export interface MenuSection { title: string; items: MenuItem[] }

/** Tally Gateway-style menu: sections of items, arrow keys + Enter, or the underlined letter. */
export function Menu({ title, sections, active }: { title: string; sections: MenuSection[]; active: boolean }) {
  const items = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const [sel, setSel] = useListNav(items.length, active, (i) => items[i].run());
  useKeys(items.filter((i) => i.hotkey).map((i) => ({ key: i.hotkey!.toLowerCase(), run: () => i.run() })), active, { bar: false });

  let idx = -1;
  return (
    <div className="w-80 bg-panel border border-line shadow-sm">
      <div className="bg-brand text-white text-center text-sm font-semibold py-1.5">{title}</div>
      <div className="py-2">
        {sections.map((s) => (
          <div key={s.title} className="mb-2">
            {s.title && <div className="px-4 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{s.title}</div>}
            {s.items.map((it) => {
              idx++;
              const i = idx;
              return (
                <button key={it.label} data-row={i} onClick={() => { setSel(i); it.run(); }} onMouseEnter={() => setSel(i)}
                  className={`w-full text-left px-6 py-0.5 flex ${sel === i ? 'row-sel' : ''}`}>
                  <span><HotLabel label={it.label} hotkey={it.hotkey} /></span>
                  {it.hint && <span className="ml-auto text-xs text-muted">{it.hint}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HotLabel({ label, hotkey }: { label: string; hotkey?: string }) {
  if (!hotkey) return <>{label}</>;
  const i = label.toLowerCase().indexOf(hotkey.toLowerCase());
  if (i < 0) return <>{label}</>;
  return <>{label.slice(0, i)}<span className="hk">{label[i]}</span>{label.slice(i + 1)}</>;
}
