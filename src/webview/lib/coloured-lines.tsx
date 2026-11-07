import { type Token, tokenStyle } from './use-highlight';

/** One line's tokens, coloured; plain text stays plain. */
export function ColouredTokens({ tokens }: { tokens: Token[] }) {
  return tokens.map((token, index) => {
    const style = tokenStyle(token);
    return style ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: tokens have no identity beyond their order
      <span key={index} className="tok" style={style}>
        {token.content}
      </span>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: tokens have no identity beyond their order
      <span key={index}>{token.content}</span>
    );
  });
}
/** Coloured lines of a code block, joined by newlines. */
export function ColouredLines({ lines }: { lines: Token[][] }) {
  return lines.map((line, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity beyond their order
    <span key={index}>
      <ColouredTokens tokens={line} />
      {index < lines.length - 1 ? '\n' : ''}
    </span>
  ));
}
