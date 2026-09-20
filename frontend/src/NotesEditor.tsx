import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, List, ListOrdered, Redo2, Undo2 } from 'lucide-react';
import { docToMd, mdToHtml } from './mdconv';

const Btn = ({ on, active, label, children, disabled }: { on: () => void; active?: boolean; label: string; children: React.ReactNode; disabled?: boolean }) => (
  <button type="button" title={label} aria-label={label} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={on}
    className={`rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30 ${active ? 'bg-slate-200 text-head' : ''}`}>{children}</button>
);
function Bar({ ed }: { ed: Editor }) {
  return (
    <div className="flex items-center gap-0.5 border-b border-line bg-soft px-1.5 py-1">
      <Btn label="Gras" active={ed.isActive('bold')} on={() => ed.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></Btn>
      <Btn label="Italique" active={ed.isActive('italic')} on={() => ed.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></Btn>
      <span className="mx-1 h-4 w-px bg-line" />
      <Btn label="Liste à puces" active={ed.isActive('bulletList')} on={() => ed.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></Btn>
      <Btn label="Liste numérotée" active={ed.isActive('orderedList')} on={() => ed.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Btn>
      <span className="mx-1 h-4 w-px bg-line" />
      <Btn label="Annuler" disabled={!ed.can().undo()} on={() => ed.chain().focus().undo().run()}><Undo2 className="h-4 w-4" /></Btn>
      <Btn label="Rétablir" disabled={!ed.can().redo()} on={() => ed.chain().focus().redo().run()}><Redo2 className="h-4 w-4" /></Btn>
    </div>
  );
}

/**
 * Éditeur WYSIWYG compact (gras, italique, listes) pour les notes de séance. Le contenu est échangé en Markdown : c'est le format que le
 * procès-verbal met en page. Pas de titres ni de tableaux : ce sont des notes, pas un document.
 */
export default function NotesEditor({ value, onChange, placeholder, label }: { value: string; onChange: (md: string) => void; placeholder?: string; label: string }) {
  const last = useRef(value);
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false, code: false, strike: false }), Placeholder.configure({ placeholder: placeholder || '' })],
    content: mdToHtml(value),
    editorProps: { attributes: { class: 'prose-doc min-h-[110px] max-h-[260px] overflow-y-auto px-3 py-2 outline-none', 'aria-label': label, spellcheck: 'true', lang: 'fr' } },
    onUpdate: ({ editor: ed }) => { const md = docToMd(ed.getJSON() as any); last.current = md; onChange(md); },
  });
  // valeur modifiée de l'extérieur (changement de point, autre poste) : on ne touche pas au curseur sinon
  useEffect(() => { if (editor && value !== last.current) { last.current = value; editor.commands.setContent(mdToHtml(value), false); } }, [value, editor]);
  if (!editor) return null;
  return <div className="overflow-hidden rounded border border-slate-300 bg-surface focus-within:border-action"><Bar ed={editor} /><EditorContent editor={editor} /></div>;
}
