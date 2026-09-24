import { t } from './i18n';
import { StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { editorInfoField, setIcon } from 'obsidian';
import type { TFile } from 'obsidian';
export type BindProgress = (el: HTMLElement, file: () => TFile | null | undefined) => () => void;
export function voiceButton(doc: Document, start: () => void): HTMLElement {
  const wrap = doc.win.createDiv({ cls: 'voice-append-footer' });
  const content = doc.win.createDiv({ cls: 'voice-append-footer-content' });
  const button = doc.win.createEl('button', { cls: 'voice-append-button' }); button.type = 'button';
  const icon = doc.win.createSpan(); setIcon(icon, 'mic'); button.append(icon, doc.createTextNode(t('Gedanken ergänzen')));
  button.onclick = start; content.append(button); wrap.append(content); return wrap;
}
export function footerExtension(start: (file: TFile) => void, bindProgress: BindProgress) {
  const disposers = new WeakMap<HTMLElement, () => void>();
  class Footer extends WidgetType {
    eq() { return true; }
    toDOM(view: EditorView) {
      const getFile = () => view.state.field(editorInfoField, false)?.file;
      const el = voiceButton(view.dom.ownerDocument, () => { const file = getFile(); if (file) start(file); });
      const content = el.querySelector<HTMLElement>('.voice-append-footer-content')!;
      let frame = 0;
      const center = () => {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => {
          content.setCssProps({ transform: '' });
          const viewport = view.scrollDOM.getBoundingClientRect();
          const rect = content.getBoundingClientRect();
          if (rect.width) content.setCssProps({ transform: `translateX(${viewport.left + viewport.width / 2 - rect.left - rect.width / 2}px)` });
        });
      };
      const observer = new ResizeObserver(center); observer.observe(view.scrollDOM); observer.observe(content); center();
      const disposeProgress = bindProgress(el, getFile);
      disposers.set(el, () => { observer.disconnect(); window.cancelAnimationFrame(frame); disposeProgress(); }); return el;
    }
    destroy(dom: HTMLElement) { disposers.get(dom)?.(); disposers.delete(dom); }
    ignoreEvent() { return true; }
  }
  const decorate = (length: number) => Decoration.set([Decoration.widget({ widget: new Footer(), block: true, side: 1 }).range(length)]);
  return StateField.define<DecorationSet>({ create: state => decorate(state.doc.length), update: (value, transaction) => transaction.docChanged ? decorate(transaction.state.doc.length) : value, provide: field => EditorView.decorations.from(field) });
}
