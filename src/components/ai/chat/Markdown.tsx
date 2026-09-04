import * as React from "react";
import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a model's markdown answer.
 *
 * Code blocks stay monospace with a copy button rather than a syntax-highlight
 * pass — most blocks here are log excerpts and short JSON/spark-submit snippets,
 * where colour adds little and a highlighting dependency is heavy. GFM features
 * (tables, task lists, autolinks) are enabled with remark-gfm.
 *
 * Links are shown as plain underlined text only: there is no shell plugin wired
 * up, so a click that did nothing would be worse than no link at all.
 */
export function Markdown({ text }: { text: string }) {
  const components = useMemo(
    () => ({
      // Block code: a labelled, copyable panel. The `<pre>` from
      // react-markdown always wraps a single `<code>` whose className carries
      // `language-<lang>` and whose children are the raw text.
      pre: (props: React.HTMLAttributes<HTMLPreElement>) => {
        const codeChild = React.isValidElement(props.children) ? props.children : null;
        const child = codeChild as React.ReactElement<{ className?: string; children?: unknown }> | null;
        const language = /language-([\w-]+)/.exec(child?.props?.className ?? "")?.[1];
        const raw = String(child?.props?.children ?? "");
        return <MarkdownCodeBlock language={language} raw={raw} />;
      },
      // Inline code renders inline rather than as a block.
      code: (props: CodeProps) => (
        <code
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
          {...withoutNode(props)}
        />
      ),
      p: (props: MarkdownProps) => (
        <p className="my-2 break-words text-sm leading-relaxed" {...withoutNode(props)} />
      ),
      h1: heading("text-lg"),
      h2: heading("text-base"),
      h3: heading("text-sm"),
      h4: heading("text-sm"),
      h5: heading("text-sm"),
      h6: heading("text-sm"),
      ul: (props: ListProps) => (
        <ul className="my-2 list-disc space-y-1 pl-5 text-sm" {...withoutNode(props)} />
      ),
      ol: (props: ListProps) => (
        <ol className="my-2 list-decimal space-y-1 pl-5 text-sm" {...withoutNode(props)} />
      ),
      li: (props: MarkdownProps) => (
        <li className="break-words text-sm leading-relaxed" {...withoutNode(props)} />
      ),
      blockquote: (props: MarkdownProps) => (
        <blockquote
          className="my-2 border-l-2 border-muted pl-3 text-sm text-muted-foreground"
          {...withoutNode(props)}
        />
      ),
      a: (props: MarkdownProps) => (
        <span className="break-words text-sm underline underline-offset-2">{props.children}</span>
      ),
      table: (props: MarkdownProps) => (
        <div className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm" {...withoutNode(props)} />
        </div>
      ),
      th: (props: MarkdownProps) => (
        <th className="border bg-muted/50 px-2 py-1 text-left font-medium" {...withoutNode(props)} />
      ),
      td: (props: MarkdownProps) => (
        <td className="border px-2 py-1 align-top" {...withoutNode(props)} />
      )
    }),
    []
  );

  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>;
}

/** Shared props react-markdown hands a component: HTML attributes plus its node. */
type MarkdownProps = React.HTMLAttributes<HTMLElement> & { node?: unknown };
type ListProps = React.HTMLAttributes<HTMLUListElement> & { node?: unknown };
type CodeProps = React.HTMLAttributes<HTMLElement> & { node?: unknown };

/** Strips react-markdown's `node` prop, which must not leak onto DOM elements. */
function withoutNode<P extends { node?: unknown }>({ node: _node, ...rest }: P) {
  return rest;
}

/** A heading sized by level; the tight margins sit under the avatar row. */
function heading(sizeClass: string) {
  return (props: MarkdownProps) => (
    <p className={`mt-3 mb-1 font-semibold tracking-tight ${sizeClass}`} {...withoutNode(props)} />
  );
}

/** The labelled code panel: language tag, copy button, and a scrollable body. */
function MarkdownCodeBlock({
  language,
  raw,
  className
}: {
  language?: string;
  raw: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const label = language || "code";

  const copy = () => {
    navigator.clipboard.writeText(raw).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {
        /* The body copy button has its own toast; a silent failure here is fine. */
      }
    );
  };

  return (
    <div className="my-2 overflow-hidden rounded-md border bg-muted/40">
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1">
        <span className="truncate font-mono text-xs text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={`Copy ${label} code`}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words p-2 font-mono text-xs leading-relaxed text-foreground">
        {raw}
      </pre>
    </div>
  );
}
