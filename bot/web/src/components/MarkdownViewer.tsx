import { MarkdownEditor } from "./MarkdownEditor";

interface MarkdownViewerProps {
  content: string;
  className?: string;
}

export function MarkdownViewer({ content, className = "" }: MarkdownViewerProps) {
  return <MarkdownEditor content={content} readOnly className={className} />;
}
