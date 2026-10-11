import { useHighlighted, type CodeLanguage } from '../lib/highlight'

/** Syntax-highlighted code; renders plain text until the highlighter has loaded. */
export function CodeBlock({ code, language, className = '' }: { code: string; language: CodeLanguage | 'http'; className?: string }) {
  const html = useHighlighted(code, language)
  return (
    <div className={`ad-code ad-scroll overflow-auto font-mono text-[12px] leading-[21px] ${className}`}>
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="text-sx-text">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
