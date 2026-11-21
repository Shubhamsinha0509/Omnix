"use client";

import { isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";

/** A fenced code block, highlighted by shiki and safe to re-render while it streams. */
function CodeFence({ code, language }: { code: string; language: string }) {
  const lines = useHighlightedCode(code, language);

  return (
    <CodeBlock size="sm" className="my-3">
      {language && (
        <CodeBlockHeader>
          <CodeBlockTitle>{language}</CodeBlockTitle>
        </CodeBlockHeader>
      )}
      <CodeBlockActions>
        <CodeBlockCopyButton value={code} />
      </CodeBlockActions>
      <CodeBlockContent>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

/** Pulls the text and language out of the `<code>` element react-markdown puts inside `<pre>`. */
function readFence(children: ReactNode) {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) return null;

  const text = children.props.children;
  if (typeof text !== "string") return null;

  const language = /language-([\w-]+)/.exec(children.props.className ?? "")?.[1] ?? "";
  // Markdown always ends a fence with a newline; it would render as a blank last line.
  return { text: text.replace(/\n$/, ""), language };
}

// Tailwind classes per element: the typography plugin isn't installed, and chat
// replies only use a small set of tags.
const components: Components = {
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mt-5 mb-2 text-base font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-5 mb-2 text-base font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-4 mb-2 text-sm font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-4 mb-2 text-sm font-semibold first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="my-3 ms-5 list-disc space-y-1 first:mt-0 last:mb-0">{children}</ul>,
  // Keep `start` so a list that begins at 3 (common when a reply resumes a list) isn't renumbered.
  ol: ({ children, start }) => (
    <ol start={start} className="my-3 ms-5 list-decimal space-y-1 first:mt-0 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="[&>p]:my-0">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="font-medium underline underline-offset-2 hover:text-primary"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-s-2 ps-3 text-muted-foreground first:mt-0 last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  table: ({ children }) => (
    <div className="my-3 w-full overflow-x-auto first:mt-0 last:mb-0">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted px-2.5 py-1.5 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2.5 py-1.5 align-top">{children}</td>,
  // Inline code. Fenced blocks never reach this: `pre` below replaces them whole.
  code: ({ children, className }) => (
    <code className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]", className)}>
      {children}
    </code>
  ),
  pre: ({ children }) => {
    const fence = readFence(children);
    return fence ? <CodeFence code={fence.text} language={fence.language} /> : <pre>{children}</pre>;
  },
};

/**
 * Renders an agent's reply as Markdown. Re-renders cheaply while the reply
 * streams in, and only renders the tags above — no raw HTML is allowed through.
 */
function MarkdownImpl({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("min-w-0 text-sm leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
