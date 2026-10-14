// Layered keyboard handling. Each screen, dialog or the app shell registers a layer of key
// bindings; the most recently mounted enabled layer gets first refusal. Labelled bindings of
// the top screen layer are shown in the right-hand button bar, Tally Prime style.
import { useEffect, useRef, useSyncExternalStore } from 'react';

export interface Binding {
  key: string; // 'F5', 'ctrl+a', 'alt+x', 'Escape', 'ArrowDown', 'c'
  label?: string; // shown in the button bar when present
  run: (e: KeyboardEvent) => void | boolean; // return false to let lower layers handle it
  inInputs?: boolean; // also fire when focus is in a text field (default: only for modified/function keys)
  hidden?: boolean;
}

interface Layer { id: number; bindings: Binding[]; enabled: boolean; modal: boolean; bar: boolean }

let layers: Layer[] = [];
let version = 0;
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => { version++; listeners.forEach((l) => l()); };

export function normalize(e: KeyboardEvent) {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.shiftKey && e.key.length > 1) parts.push('shift');
  parts.push(k);
  return parts.join('+');
}

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
const PLAIN_IN_INPUT = new Set(['Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Home', 'End', ' ']);

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented) return;
  const k = normalize(e);
  const editable = isEditable(e.target);
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey && (e.key.length === 1 || PLAIN_IN_INPUT.has(e.key));
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer.enabled) continue;
    for (const b of layer.bindings) {
      if (b.key !== k) continue;
      if (editable && plain && !b.inInputs) continue;
      if (b.run(e) !== false) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    if (layer.modal) return;
  }
  // Function keys would otherwise reload the page, open search, etc.
  if (/^F\d+$/.test(e.key) || (e.altKey && e.key.length === 1)) e.preventDefault();
}

if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown);

/**
 * Registers key bindings for the life of the component. `enabled` follows whether this screen
 * is the visible one; `modal` stops keys reaching layers below (for dialogs).
 */
export function useKeys(bindings: Binding[], enabled = true, opts: { modal?: boolean; bar?: boolean } = {}) {
  const layer = useRef<Layer | null>(null);
  if (!layer.current) layer.current = { id: nextId++, bindings, enabled, modal: !!opts.modal, bar: opts.bar ?? true };
  layer.current.bindings = bindings;
  layer.current.enabled = enabled;
  useEffect(() => {
    // Order by first render, not effect order: parents render before children and earlier
    // screens before later ones, so the shell sits at the bottom and dialogs on top.
    layers = [...layers, layer.current!].sort((a, b) => a.id - b.id);
    notify();
    return () => { layers = layers.filter((l) => l !== layer.current); notify(); };
  }, []);
  const labels = bindings.filter((b) => b.label && !b.hidden).map((b) => `${b.key}:${b.label}`).join('|');
  useEffect(() => { notify(); }, [enabled, labels]);
}

/** Labelled bindings of the topmost enabled bar layer, for the button bar. */
export function useBarBindings(): Binding[] {
  useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => version);
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.enabled && l.bar) return l.bindings.filter((b) => b.label && !b.hidden);
  }
  return [];
}

export function pressKey(b: Binding) {
  b.run(new KeyboardEvent('keydown'));
}

export const keyLabel = (k: string) =>
  k.replace('ctrl+', 'Ctrl+').replace('alt+', 'Alt+').replace('shift+', 'Shift+')
    .replace(/\+([a-z])$/, (_m, c) => `+${c.toUpperCase()}`).replace('Escape', 'Esc');

// ---------- Enter-to-advance form navigation ----------

const FOCUSABLE = 'input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button[data-nav]';

function navItems(from: HTMLElement) {
  const form = from.closest('[data-form]') as HTMLElement | null;
  if (!form) return { form: null, items: [] as HTMLElement[] };
  const items = Array.from(form.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => !el.closest('[data-nonav]') && el.offsetParent !== null);
  return { form, items };
}

/** Moves focus to the next field in the enclosing [data-form]; fires 'formend' at the last one. */
export function focusNext(from: HTMLElement) {
  const { form, items } = navItems(from);
  if (!form) return;
  const i = items.indexOf(from);
  const next = items[i + 1];
  if (next) {
    next.focus();
    if (next instanceof HTMLInputElement) next.select();
  } else form.dispatchEvent(new CustomEvent('formend', { bubbles: false }));
}
/** Focuses the first field after `container` (e.g. after a table when "End of List" is picked). */
export function focusAfter(container: HTMLElement | null) {
  if (!container) return;
  const { form, items } = navItems(container.querySelector(FOCUSABLE) as HTMLElement ?? container);
  if (!form) return;
  const next = items.find((el) => !container.contains(el) && (container.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
  if (next) { next.focus(); if (next instanceof HTMLInputElement) next.select(); }
  else form.dispatchEvent(new CustomEvent('formend', { bubbles: false }));
}
export function focusPrev(from: HTMLElement) {
  const { items } = navItems(from);
  const prev = items[items.indexOf(from) - 1];
  if (prev) { prev.focus(); if (prev instanceof HTMLInputElement) prev.select(); }
}

/** onKeyDown for a [data-form] container: Enter advances, Backspace on an empty field goes back. */
export function formKeyDown(e: React.KeyboardEvent) {
  const el = e.target as HTMLElement;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key === 'Enter' && (el.tagName === 'INPUT' || el.tagName === 'SELECT')) {
    e.preventDefault();
    focusNext(el);
  } else if (e.key === 'Backspace' && el instanceof HTMLInputElement && el.value === '' && el.type !== 'checkbox') {
    e.preventDefault();
    focusPrev(el);
  }
}
