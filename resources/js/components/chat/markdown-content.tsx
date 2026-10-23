import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Raw HTML in the text is escaped, not rendered, and react-markdown empties unsafe link
// targets such as javascript:. Elements are created by React; no HTML string is injected.
const components: Components = {
    // A link whose target was removed stays readable as text instead of linking to this page.
    a: ({ href, children }) =>
        href ? (
            <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-medium underline underline-offset-2"
            >
                {children}
            </a>
        ) : (
            <span>{children}</span>
        ),
    p: ({ children }) => (
        <p className="my-2 first:mt-0 last:mb-0">{children}</p>
    ),
    ul: ({ children }) => (
        <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
    ),
    ol: ({ children }) => (
        <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
    ),
    blockquote: ({ children }) => (
        <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
            {children}
        </blockquote>
    ),
    h1: ({ children }) => (
        <h3 className="mt-4 mb-2 text-base font-semibold">{children}</h3>
    ),
    h2: ({ children }) => (
        <h3 className="mt-4 mb-2 text-base font-semibold">{children}</h3>
    ),
    h3: ({ children }) => (
        <h4 className="mt-3 mb-1 font-semibold">{children}</h4>
    ),
    pre: ({ children }) => (
        <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0">
            {children}
        </pre>
    ),
    code: ({ children }) => (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {children}
        </code>
    ),
    table: ({ children }) => (
        <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
                {children}
            </table>
        </div>
    ),
    th: ({ children }) => (
        <th className="border-b border-border px-2 py-1 font-semibold">
            {children}
        </th>
    ),
    td: ({ children }) => (
        <td className="border-b border-border/60 px-2 py-1">{children}</td>
    ),
};

export function MarkdownContent({ text }: { text: string }) {
    return (
        <div className="text-sm leading-relaxed break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {text}
            </ReactMarkdown>
        </div>
    );
}
