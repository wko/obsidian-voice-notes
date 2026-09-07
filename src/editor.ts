import { t } from './i18n';
import { StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { editorInfoField, setIcon } from 'obsidian';
import type { TFile } from 'obsidian';
export type BindProgress = (el: HTMLElement, file: () => TFile | null | undefined) => () => void;
export function voiceButton(doc: Document, start: () => void): HTMLElement {
  const wrap = doc.createElement('div'); wrap.className = 'voice-append-footer';
  const button = doc.createElement('button'); button.className = 'voice-append-button'; button.type = 'button';
  const icon = doc.createElement('span'); setIcon(icon, 'mic'); button.append(icon, doc.createTextNode(t('Gedanken ergänzen')));
  button.onclick = start; wrap.append(button); return wrap;
}
export function footerExtension(start: (file: TFile) => void, bindProgress: BindProgress) {
  const disposers = new WeakMap<HTMLElement, () => void>();
  class Footer extends WidgetType {
    eq() { return true; }
    toDOM(view: EditorView) {
      const getFile = () => view.state.field(editorInfoField, false)?.file;
      const el = voiceButton(view.dom.ownerDocument, () => { const file = getFile(); if (file) start(file); });
      disposers.set(el, bindProgress(el, getFile)); return el;
    }
    destroy(dom: HTMLElement) { disposers.get(dom)?.(); disposers.delete(dom); }
    ignoreEvent() { return true; }
  }
  const decorate = (length: number) => Decoration.set([Decoration.widget({ widget: new Footer(), block: true, side: 1 }).range(length)]);
  return StateField.define<DecorationSet>({ create: state => decorate(state.doc.length), update: (value, transaction) => transaction.docChanged ? decorate(transaction.state.doc.length) : value, provide: field => EditorView.decorations.from(field) });
}
