import type { ReactNode } from 'react';

// Tiny, safe inline renderer for the small markdown bodies used in POIs.
// Supports **bold**, *italic*, and [text](url) for HTTP(S) or POI hash links.
// No raw HTML is ever injected.
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex =
    /\*\*(.+?)\*\*|\*(.+?)\*|\[(.+?)\]\((https?:\/\/[^\s)]+|#\/[a-z0-9-]+\/[a-z0-9-]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(<strong key={`${keyBase}-b${i}`}>{m[1]}</strong>);
    } else if (m[2] !== undefined) {
      nodes.push(<em key={`${keyBase}-i${i}`}>{m[2]}</em>);
    } else if (m[3] !== undefined && m[4] !== undefined) {
      const isStoryLink = m[4].startsWith('#/');
      nodes.push(
        <a
          key={`${keyBase}-a${i}`}
          href={m[4]}
          target={isStoryLink ? undefined : '_blank'}
          rel={isStoryLink ? undefined : 'noreferrer'}
        >
          {m[3]}
        </a>,
      );
    }
    last = regex.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ text }: { text: string }): ReactNode {
  const paragraphs = text.split(/\n\s*\n/);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i}>{renderInline(p.trim(), `p${i}`)}</p>
      ))}
    </>
  );
}
