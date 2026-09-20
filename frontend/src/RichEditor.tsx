import { useEffect, useRef } from 'react';
import { Extension } from '@tiptap/core';
import { EditorContent, useEditor, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin } from '@tiptap/pm/state';
import { Bold, Italic, List, ListOrdered, Plus, Redo2, Undo2 } from 'lucide-react';
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

function Btn({ active, onClick, title, children, disabled }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode; disabled?: boolean }) {
  return <button type="button" title={title} aria-label={title} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
    className={`rounded p-2 hover:bg-slate-100 disabled:opacity-40 ${active ? 'bg-primary text-white hover:bg-primary' : 'text-slate-700'}`}>{children}</button>;
}

function Toolbar({ editor, mode }: { editor: Editor; mode: EditorMode }) {
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
      {mode === 'expose' && <>
        <Btn title="Liste à puces" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></Btn>
        <Btn title="Liste numérotée" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Btn>
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
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false, code: false, strike: false, ...(mode === 'expose' ? {} : { bulletList: false, orderedList: false, listItem: false }) }),
      Placeholder.configure({ placeholder: placeholder || '' }),
      ...(mode === 'dispositif' ? [Articles] : []),
    ],
    content: mdToHtml(value),
    editable: !readOnly,
    editorProps: { attributes: { class: 'prose-doc', 'aria-label': 'Zone de saisie du texte', spellcheck: 'true', lang: 'fr' } },
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
