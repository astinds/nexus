/**
 * Markdown rendering with no HTML injection.
 *
 * `dangerouslySetInnerHTML` is banned in this codebase (ADR-015): a note is
 * user-authored, a web article is third-party, and either can contain a script
 * tag. Parsing lives in `lib/markdown.ts` and returns tokens; this file only turns
 * tokens into React elements, so markup can never reach the DOM.
 */

import type { ReactNode } from 'react';
import { inlineSegments, parseBlocks, type InlineToken } from '@/lib/markdown';

function inlineNodes(tokens: InlineToken[], keyPrefix: string): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case 'bold':
        return <strong key={key}>{token.text}</strong>;
      case 'italic':
        return <em key={key}>{token.text}</em>;
      case 'code':
        return (
          <code key={key} className="rounded bg-[var(--surface-2)] px-1 py-0.5 text-[0.9em]">
            {token.text}
          </code>
        );
      case 'link':
        return token.safe ? (
          <a
            key={key}
            href={token.href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-[var(--accent)] underline-offset-2"
          >
            {token.text}
          </a>
        ) : (
          <span key={key}>{token.text}</span>
        );
      default:
        return <span key={key}>{token.text}</span>;
    }
  });
}

export default function MarkdownView({
  source,
  className = '',
}: {
  source: string;
  className?: string;
}) {
  const blocks = parseBlocks(source);

  if (blocks.length === 0) {
    return <p className="text-sm opacity-50">Empty note.</p>;
  }

  return (
    <div className={`space-y-3 text-[0.95em] leading-relaxed ${className}`}>
      {blocks.map((block, index) => {
        const key = `b-${index}`;
        switch (block.kind) {
          case 'heading': {
            const size =
              block.level === 1
                ? 'text-lg font-semibold'
                : block.level === 2
                  ? 'text-base font-semibold'
                  : 'text-sm font-semibold';
            return (
              <p key={key} className={`${size} mt-4 first:mt-0`}>
                {inlineNodes(inlineSegments(block.text), key)}
              </p>
            );
          }
          case 'paragraph':
            return (
              <p key={key} className="whitespace-pre-line">
                {inlineNodes(inlineSegments(block.text), key)}
              </p>
            );
          case 'list': {
            const items = block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>
                {item.task === null ? null : (
                  <input
                    type="checkbox"
                    checked={item.task}
                    readOnly
                    className="mr-1.5 align-middle"
                    aria-label={item.task ? 'done' : 'not done'}
                  />
                )}
                {inlineNodes(inlineSegments(item.text), `${key}-${itemIndex}`)}
              </li>
            ));
            return block.ordered ? (
              <ol key={key} className="list-decimal space-y-1 pl-5">
                {items}
              </ol>
            ) : (
              <ul key={key} className="list-disc space-y-1 pl-5">
                {items}
              </ul>
            );
          }
          case 'quote':
            return (
              <blockquote
                key={key}
                className="border-l-2 border-[var(--accent)] pl-3 opacity-90"
              >
                {inlineNodes(inlineSegments(block.text), key)}
              </blockquote>
            );
          case 'code':
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-lg bg-[var(--surface-2)] p-3 text-xs"
              >
                <code>{block.text}</code>
              </pre>
            );
          case 'hr':
            return <hr key={key} className="border-[var(--border)]" />;
          default:
            return null;
        }
      })}
    </div>
  );
}
