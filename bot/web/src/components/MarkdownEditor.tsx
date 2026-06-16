import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useEffect } from "react";

function getMarkdown(editor: Editor): string {
  return (editor.storage as Record<string, any>).markdown.getMarkdown();
}

interface MarkdownEditorProps {
  content: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  className?: string;
}

export function MarkdownEditor({
  content,
  onChange,
  readOnly = false,
  className = "",
}: MarkdownEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        html: false,
        breaks: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: "",
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      if (onChange) {
        onChange(getMarkdown(editor));
      }
    },
  });

  // Set content via setContent() so tiptap-markdown parses markdown properly
  useEffect(() => {
    if (editor && content && content !== getMarkdown(editor)) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  if (!editor) return null;

  return (
    <div className={`markdown-editor border rounded-md ${className}`}>
      {!readOnly && (
        <div className="flex gap-1 p-2 border-b bg-muted/50 flex-wrap">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`px-2 py-1 text-sm rounded hover:bg-accent ${editor.isActive("bold") ? "bg-accent" : ""}`}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`px-2 py-1 text-sm rounded hover:bg-accent ${editor.isActive("italic") ? "bg-accent" : ""}`}
          >
            <em>I</em>
          </button>
          <span className="w-px bg-border mx-1" />
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`px-2 py-1 text-sm rounded hover:bg-accent ${editor.isActive("heading", { level: 1 }) ? "bg-accent" : ""}`}
          >
            H1
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`px-2 py-1 text-sm rounded hover:bg-accent ${editor.isActive("heading", { level: 2 }) ? "bg-accent" : ""}`}
          >
            H2
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={`px-2 py-1 text-sm rounded hover:bg-accent ${editor.isActive("heading", { level: 3 }) ? "bg-accent" : ""}`}
          >
            H3
          </button>
          <span className="w-px bg-border mx-1" />
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`px-2 py-1 text-sm rounded hover:bg-accent ${editor.isActive("bulletList") ? "bg-accent" : ""}`}
          >
            List
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`px-2 py-1 text-sm rounded hover:bg-accent ${editor.isActive("orderedList") ? "bg-accent" : ""}`}
          >
            1.
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={`px-2 py-1 text-sm rounded hover:bg-accent ${editor.isActive("codeBlock") ? "bg-accent" : ""}`}
          >
            Code
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={`px-2 py-1 text-sm rounded hover:bg-accent ${editor.isActive("blockquote") ? "bg-accent" : ""}`}
          >
            Quote
          </button>
        </div>
      )}
      <EditorContent
        editor={editor}
        className={`prose prose-sm prose-invert max-w-none p-4 ${readOnly ? "" : "min-h-[200px] focus-within:outline-none"}`}
      />
    </div>
  );
}
