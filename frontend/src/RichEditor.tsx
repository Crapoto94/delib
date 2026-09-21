import { useEffect, useRef, useState } from 'react';
import { Extension } from '@tiptap/core';
import { EditorContent, useEditor, Editor, ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Plugin } from '@tiptap/pm/state';
import { Bold, Italic, List, ListOrdered, Plus, Redo2, Undo2, Image as ImageIcon, Table as TableIcon, Columns3, Rows3, Trash2, AlignLeft, AlignCenter, AlignRight, AlignJustify, RotateCcw, RotateCw, Maximize2 } from 'lucide-react';
import { docToMd, mdToHtml } from './mdconv';

export type EditorMode = 'expose' | 'visas' | 'dispositif';
const ARTICLE = /^Article\s+(\d+)/i;

const countArticles = (doc: any) => { let n = 0; doc.descendants((node: any) => { if (node.type.name === 'paragraph' && ARTICLE.test(node.textContent)) n++; }); return n; };

/**
 * Dispositif (« Délibéré »), D39 / EDI-02 : « Article N » est saisi automatiquement et en gras, renuméroté à chaque insertion
 * ou suppression ; Entrée = nouvel article, Maj + Entrée = simple retour à la ligne dans l'article.
 */
const Articles = Extension.create({
  name: 'articles',
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        if (selection.$from.parent.type.name !== 'paragraph') return false; // dans une liste : comportement habituel
        const next = countArticles(editor.state.doc) + 1;
        return editor.chain().splitBlock().insertContent([{ type: 'text', text: `Article ${next}`, marks: [{ type: 'bold' }] }, { type: 'text', text: ' : ' }]).run();
      },
      'Shift-Enter': ({ editor }) => editor.commands.setHardBreak(),
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(_trs, _old, state) {
        const tr = state.tr; const bold = state.schema.marks.bold; let n = 0;
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'paragraph') return;
          const m = ARTICLE.exec(node.textContent); if (!m) return;
          n++;
          const wanted = `Article ${n}`; const from = tr.mapping.map(pos + 1);
          if (m[0] !== wanted) tr.insertText(wanted, from, from + m[0].length);
          tr.addMark(from, from + wanted.length, bold.create());
        });
        return tr.docChanged ? tr : null;
      },
    })];
  },
});

/**
 * Alignement de paragraphe (gauche, centré, droite, justifié), comme dans Word. Attribut de paragraphe conservé
 * dans le markdown sous forme de préfixe `{center}` / `{right}` / `{justify}` (rien pour « à gauche »).
 */
const TextAlign = Extension.create({
  name: 'textAlign',
  addGlobalAttributes() {
    return [{
      types: ['paragraph'],
      attributes: {
        textAlign: {
          default: 'left',
          parseHTML: (el: HTMLElement) => el.style.textAlign || el.getAttribute('align') || 'left',
          renderHTML: (attrs: any) => (attrs.textAlign && attrs.textAlign !== 'left' ? { style: `text-align:${attrs.textAlign}` } : {}),
        },
      },
    }];
  },
});

/** Image redimensionnable (poignées), orientable et alignable ; les réglages partent dans le markdown (`#vd:…`). */
const VdImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: (el: HTMLElement) => { const v = el.getAttribute('data-width'); return v ? Number(v) : null; }, renderHTML: (attrs: any) => (attrs.width ? { 'data-width': attrs.width } : {}) },
      rotation: { default: 0, parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-rotation') || 0), renderHTML: (attrs: any) => (attrs.rotation ? { 'data-rotation': attrs.rotation } : {}) },
      align: { default: 'left', parseHTML: (el: HTMLElement) => el.getAttribute('data-align') || 'left', renderHTML: (attrs: any) => (attrs.align && attrs.align !== 'left' ? { 'data-align': attrs.align } : {}) },
    };
  },
  addNodeView() { return ReactNodeViewRenderer(ImageNodeView); },
});

function ImageNodeView(props: NodeViewProps) {
  const { node, updateAttributes, selected, editor, getPos } = props;
  const { src, alt, align } = node.attrs;
  const [w, setW] = useState<number | null>(typeof node.attrs.width === 'number' ? node.attrs.width : null);
  const [rot, setRot] = useState<number>(Number(node.attrs.rotation) || 0);
  useEffect(() => { setW(typeof node.attrs.width === 'number' ? node.attrs.width : null); }, [node.attrs.width]);
  useEffect(() => { setRot(Number(node.attrs.rotation) || 0); }, [node.attrs.rotation]);
  const imgRef = useRef<HTMLImageElement>(null);
  const editable = editor.isEditable;
  const select = () => { const p = getPos(); if (editable && typeof p === 'number') editor.commands.setNodeSelection(p); };

  const dragResize = (e: React.PointerEvent, corner: 'nw' | 'ne' | 'sw' | 'se') => {
    if (!editable) return;
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX; const sy = e.clientY;
    const start = imgRef.current?.getBoundingClientRect().width || w || 320;
    const dirX = corner.includes('w') ? -1 : 1; const dirY = corner.includes('n') ? -1 : 1;
    let current = start;
    const move = (ev: PointerEvent) => { const d = (ev.clientX - sx) * dirX + (ev.clientY - sy) * dirY; current = Math.max(40, Math.min(1000, Math.round(start + d / 1.7))); setW(current); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); updateAttributes({ width: current }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const dragRotate = (e: React.PointerEvent) => {
    if (!editable) return;
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX; const start = rot; let current = rot;
    const move = (ev: PointerEvent) => { const a = ((start + (ev.clientX - sx) * 0.8) % 360 + 360) % 360; current = Math.round(a); setRot(current); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); updateAttributes({ rotation: current }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  return (
    <NodeViewWrapper as="span" className="vd-image" data-align={align || 'left'} style={{ textAlign: align || 'left' }} contentEditable={false}>
      <span className="vd-image-frame" data-selected={selected ? 'true' : undefined}>
        <img ref={imgRef} src={src} alt={alt || ''} draggable={false} onClick={select}
          style={{ width: w ? `${w}px` : undefined, maxWidth: '100%', height: 'auto', transform: rot ? `rotate(${rot}deg)` : undefined }} />
        {editable && selected && <>
          {(['nw', 'ne', 'sw', 'se'] as const).map((c) => <span key={c} className={`vd-grip vd-grip-${c}`} onPointerDown={(e) => dragResize(e, c)} />)}
          <span className="vd-rotate" title="Faire pivoter" onPointerDown={dragRotate}>↻</span>
        </>}
      </span>
    </NodeViewWrapper>
  );
}

function readImage(file: File): Promise<string> { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); }); }

/** Insère des fichiers image (collage, dépôt, sélection) sous forme de data-URL (stockées dans le markdown). */
async function insertImages(editor: Editor, files: FileList | File[]) {
  for (const f of Array.from(files)) { if (!f.type.startsWith('image/')) continue; const src = await readImage(f); editor.chain().focus().setImage({ src, alt: f.name }).run(); }
}

function Btn({ active, onClick, title, children, disabled }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode; disabled?: boolean }) {
  return <button type="button" title={title} aria-label={title} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
    className={`rounded p-2 hover:bg-slate-100 disabled:opacity-40 ${active ? 'bg-primary text-white hover:bg-primary' : 'text-slate-700'}`}>{children}</button>;
}

function Toolbar({ editor, mode }: { editor: Editor; mode: EditorMode }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const imageAttr = editor.getAttributes('image');
  const rotateImg = (d: number) => { const r = (((Number(imageAttr.rotation) || 0) + d) % 360 + 360) % 360; editor.chain().focus().updateAttributes('image', { rotation: r }).run(); };
  const addPara = (prefix: string) => editor.chain().focus().command(({ tr, state, dispatch }) => {
    const end = state.doc.content.size; const p = state.schema.nodes.paragraph;
    if (dispatch) { const last = state.doc.lastChild; const empty = !!last && last.type.name === 'paragraph' && last.content.size === 0; tr.insert(empty ? end - 1 : end, p.create(null, state.schema.text(prefix))); }
    return true;
  }).run();
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-3 py-2" role="toolbar" aria-label="Mise en forme">
      <Btn title="Annuler" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 className="h-4 w-4" /></Btn>
      <Btn title="Rétablir" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 className="h-4 w-4" /></Btn>
      <span className="mx-1 h-5 w-px bg-line" />
      <Btn title="Gras (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></Btn>
      <Btn title="Italique (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></Btn>
      <span className="mx-1 h-5 w-px bg-line" />
      <Btn title="Aligner à gauche" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().updateAttributes('paragraph', { textAlign: 'left' }).run()}><AlignLeft className="h-4 w-4" /></Btn>
      <Btn title="Centrer" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().updateAttributes('paragraph', { textAlign: 'center' }).run()}><AlignCenter className="h-4 w-4" /></Btn>
      <Btn title="Aligner à droite" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().updateAttributes('paragraph', { textAlign: 'right' }).run()}><AlignRight className="h-4 w-4" /></Btn>
      <Btn title="Justifier" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().updateAttributes('paragraph', { textAlign: 'justify' }).run()}><AlignJustify className="h-4 w-4" /></Btn>
      {mode === 'expose' && <>
        <Btn title="Liste à puces" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></Btn>
        <Btn title="Liste numérotée" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Btn>
      </>}
      <span className="mx-1 h-5 w-px bg-line" />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const fs = e.target.files; if (fs) await insertImages(editor, fs); e.target.value = ''; }} />
      <Btn title="Insérer une image (ou copier/coller)" onClick={() => fileRef.current?.click()}><ImageIcon className="h-4 w-4" /></Btn>
      <Btn title="Insérer un tableau (ou copier/coller depuis Word)" active={editor.isActive('table')} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon className="h-4 w-4" /></Btn>
      {editor.isActive('table') && <>
        <Btn title="Ajouter une ligne" onClick={() => editor.chain().focus().addRowAfter().run()}><Rows3 className="h-4 w-4" /></Btn>
        <Btn title="Ajouter une colonne" onClick={() => editor.chain().focus().addColumnAfter().run()}><Columns3 className="h-4 w-4" /></Btn>
        <Btn title="Supprimer le tableau" onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 className="h-4 w-4" /></Btn>
      </>}
      {editor.isActive('image') && <>
        <span className="mx-1 h-5 w-px bg-line" />
        <Btn title="Image à gauche" active={(imageAttr.align || 'left') === 'left'} onClick={() => editor.chain().focus().updateAttributes('image', { align: 'left' }).run()}><AlignLeft className="h-4 w-4" /></Btn>
        <Btn title="Image centrée" active={imageAttr.align === 'center'} onClick={() => editor.chain().focus().updateAttributes('image', { align: 'center' }).run()}><AlignCenter className="h-4 w-4" /></Btn>
        <Btn title="Image à droite" active={imageAttr.align === 'right'} onClick={() => editor.chain().focus().updateAttributes('image', { align: 'right' }).run()}><AlignRight className="h-4 w-4" /></Btn>
        <Btn title="Pivoter à gauche" onClick={() => rotateImg(-90)}><RotateCcw className="h-4 w-4" /></Btn>
        <Btn title="Pivoter à droite" onClick={() => rotateImg(90)}><RotateCw className="h-4 w-4" /></Btn>
        <Btn title="Taille d'origine" onClick={() => editor.chain().focus().updateAttributes('image', { width: null }).run()}><Maximize2 className="h-4 w-4" /></Btn>
      </>}
      {mode === 'visas' && <>
        <span className="mx-1 h-5 w-px bg-line" />
        <button type="button" className="btn-secondary !py-1" onMouseDown={(e) => e.preventDefault()} onClick={() => addPara('Vu ')}><Plus className="h-3.5 w-3.5" /> Vu</button>
        <button type="button" className="btn-secondary !py-1" onMouseDown={(e) => e.preventDefault()} onClick={() => addPara('Considérant ')}><Plus className="h-3.5 w-3.5" /> Considérant</button>
      </>}
      {mode === 'dispositif' && <>
        <span className="mx-1 h-5 w-px bg-line" />
        <button type="button" className="btn-secondary !py-1" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus('end').keyboardShortcut('Enter').run()}><Plus className="h-3.5 w-3.5" /> Article</button>
        <span className="ml-2 text-[12px] text-mute"><kbd className="rounded border border-line bg-slate-50 px-1">Entrée</kbd> nouvel article · <kbd className="rounded border border-line bg-slate-50 px-1">Maj</kbd>+<kbd className="rounded border border-line bg-slate-50 px-1">Entrée</kbd> retour à la ligne</span>
      </>}
    </div>
  );
}

export default function RichEditor({ value, onChange, mode, readOnly, placeholder }: { value: string; onChange: (md: string) => void; mode: EditorMode; readOnly?: boolean; placeholder?: string }) {
  const last = useRef(value);
  const edRef = useRef<Editor | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false, code: false, strike: false, ...(mode === 'expose' ? {} : { bulletList: false, orderedList: false, listItem: false }) }),
      Placeholder.configure({ placeholder: placeholder || '' }),
      TextAlign,
      VdImage.configure({ allowBase64: true }),
      Table.configure({ resizable: false }),
      TableRow, TableHeader, TableCell,
      ...(mode === 'dispositif' ? [Articles] : []),
    ],
    content: mdToHtml(value),
    editable: !readOnly,
    onCreate: ({ editor: ed }) => { edRef.current = ed; },
    editorProps: {
      attributes: { class: 'prose-doc', 'aria-label': 'Zone de saisie du texte', spellcheck: 'true', lang: 'fr' },
      // Copier/coller ou dépôt d'une image : insérée en data-URL (les images collées de Word arrivent en fichiers).
      handlePaste: (_view, event) => { const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/')); if (files.length && edRef.current) { event.preventDefault(); void insertImages(edRef.current, files); return true; } return false; },
      handleDrop: (_view, event) => { const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/')); if (files.length && edRef.current) { event.preventDefault(); void insertImages(edRef.current, files); return true; } return false; },
    },
    onUpdate: ({ editor: ed }) => { const md = docToMd(ed.getJSON() as any); last.current = md; onChange(md); },
    onFocus: ({ editor: ed }) => {
      // dispositif vide : « Article 1 : » est déjà là
      if (mode === 'dispositif' && !readOnly && ed.isEmpty) ed.commands.setContent('<p><strong>Article 1</strong> : </p>', true, { preserveWhitespace: 'full' });
    },
  }, [mode]);

  // valeur modifiée de l'extérieur (rechargement, conflit, suggestion acceptée) : on ne touche pas au curseur sinon
  useEffect(() => { if (editor && value !== last.current) { last.current = value; editor.commands.setContent(mdToHtml(value), false); } }, [value, editor]);
  useEffect(() => { editor?.setEditable(!readOnly); }, [readOnly, editor]);

  if (!editor) return null;
  return (
    <div className="flex h-full flex-col">
      {!readOnly && <Toolbar editor={editor} mode={mode} />}
      <div className="flex-1 overflow-auto bg-soft p-4 md:p-8" onClick={() => editor.chain().focus().run()}>
        <div className="mx-auto min-h-[70vh] max-w-[820px] rounded-lg border border-line bg-surface px-6 py-8 shadow-card md:px-14"><EditorContent editor={editor} /></div>
      </div>
    </div>
  );
}
