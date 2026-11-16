/** Selective readers never decode arbitrary configuration values or include source text in errors. */
export interface Projection {
  path: string[];
  value: string | boolean | number | null;
}
type ValueType = 'string' | 'boolean' | 'number' | 'null' | 'object' | 'array';
export type Select = (path: string[], type: ValueType) => 'value' | 'presence' | undefined;
const MAX_NODES = 20_000;

export function projectJson(text: string, select: Select): Projection[] {
  let position = 0;
  let nodes = 0;
  const projected: Projection[] = [];
  function fail(): never {
    throw new Error('Unsupported configuration syntax');
  }
  function whitespace() {
    while (/\s/.test(text[position] ?? '') && position < text.length) position++;
  }
  function string(decode: boolean): string {
    const start = position;
    if (text[position++] !== '"') fail();
    while (position < text.length) {
      const char = text[position++];
      if (char === '"') return decode ? JSON.parse(text.slice(start, position)) : '';
      if (char.charCodeAt(0) < 32) fail();
      if (char !== '\\') continue;
      const escaped = text[position++];
      if (escaped === 'u') {
        if (!/^[\da-fA-F]{4}$/.test(text.slice(position, position + 4))) fail();
        position += 4;
      } else if (!escaped || !'"\\/bfnrt'.includes(escaped)) fail();
    }
    return fail();
  }
  function value(path: string[], depth: number) {
    if (++nodes > MAX_NODES || projected.length > 1000 || depth > 32) fail();
    whitespace();
    const char = text[position];
    if (char === '{' || char === '[') {
      const object = char === '{';
      if (select(path, object ? 'object' : 'array') === 'presence')
        projected.push({ path, value: 'Value hidden' });
      position++;
      whitespace();
      const end = object ? '}' : ']';
      const keys = new Set<string>();
      let index = 0;
      if (text[position] === end) {
        position++;
        return;
      }
      while (position < text.length) {
        let key = `#${index++}`;
        if (object) {
          key = string(true);
          if (keys.has(key)) fail();
          keys.add(key);
          whitespace();
          if (text[position++] !== ':') fail();
        }
        value([...path, key], depth + 1);
        whitespace();
        if (text[position] === end) {
          position++;
          return;
        }
        if (text[position++] !== ',') fail();
        whitespace();
      }
      fail();
    }
    const type: ValueType =
      char === '"'
        ? 'string'
        : /[tf]/.test(char ?? '')
          ? 'boolean'
          : char === 'n'
            ? 'null'
            : 'number';
    const mode = select(path, type);
    let parsed: Projection['value'] = null;
    if (char === '"') parsed = string(mode === 'value');
    else {
      const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(position),
      )?.[0];
      if (!token) fail();
      position += token.length;
      if (mode === 'value') parsed = JSON.parse(token);
    }
    if (mode) projected.push({ path, value: mode === 'presence' ? 'Value hidden' : parsed });
  }
  whitespace();
  if (text[position] !== '{') fail();
  value([], 0);
  whitespace();
  if (position !== text.length) fail();
  return projected;
}

/** A conservative TOML projection, not a replacement for native TOML validation. */
export function projectToml(text: string, select: Select): Projection[] {
  const projected: Projection[] = [];
  let position = 0;
  let table: string[] = [];
  let arrayIndex = 0;
  let statements = 0;
  const seen = new Set<string>();
  function fail(): never {
    throw new Error('Unsupported configuration syntax');
  }
  function space() {
    while (position < text.length) {
      if (/\s/.test(text[position])) position++;
      else if (text[position] === '#') {
        while (position < text.length && text[position] !== '\n') position++;
      } else break;
    }
  }
  function quoted(decode: boolean): string {
    const start = position;
    const quote = text[position];
    const multiline = text.slice(position, position + 3) === quote.repeat(3);
    const delimiter = multiline ? quote.repeat(3) : quote;
    position += delimiter.length;
    const contentStart = position;
    while (position < text.length) {
      if (text.slice(position, position + delimiter.length) === delimiter) {
        const contentEnd = position;
        position += delimiter.length;
        if (!decode) return '';
        if (multiline) fail();
        if (quote === "'") return text.slice(contentStart, contentEnd);
        // Restrict selected strings to JSON-compatible escapes; native TOML remains authoritative.
        return JSON.parse(text.slice(start, position));
      }
      if (!multiline && /[\r\n]/.test(text[position])) fail();
      if (quote === '"' && text[position] === '\\') position++;
      position++;
    }
    return fail();
  }
  function key(): string[] {
    const result: string[] = [];
    while (position < text.length) {
      while (/[ \t]/.test(text[position] ?? '') && position < text.length) position++;
      if (text[position] === '"' || text[position] === "'") result.push(quoted(true));
      else {
        const match = /^[A-Za-z0-9_-]+/.exec(text.slice(position))?.[0];
        if (!match) fail();
        result.push(match);
        position += match.length;
      }
      while (/[ \t]/.test(text[position] ?? '') && position < text.length) position++;
      if (text[position] !== '.') return result;
      position++;
    }
    return fail();
  }
  function skipValue(depth = 0) {
    if (depth > 32) fail();
    space();
    const char = text[position];
    if (char === '"' || char === "'") {
      quoted(false);
      return;
    }
    if (char === '[' || char === '{') {
      position++;
      const end = char === '[' ? ']' : '}';
      while (position < text.length) {
        space();
        if (text[position] === end) {
          position++;
          return;
        }
        if (text[position] === ',' || text[position] === '=') position++;
        else skipValue(depth + 1);
      }
      fail();
    }
    const start = position;
    while (position < text.length && !/[\s#,\]}=]/.test(text[position])) position++;
    if (position === start) fail();
  }
  while (position < text.length) {
    if (++statements > MAX_NODES || projected.length > 1000) fail();
    space();
    if (position === text.length) break;
    if (text[position] === '[') {
      position++;
      const array = text[position] === '[';
      if (array) position++;
      table = key();
      if (text[position++] !== ']') fail();
      if (array) {
        if (text[position++] !== ']') fail();
        table.push(`#${arrayIndex++}`);
      }
    } else {
      const field = [...table, ...key()];
      if (text[position++] !== '=') fail();
      while (/[ \t]/.test(text[position] ?? '') && position < text.length) position++;
      const char = text[position];
      const type: ValueType =
        char === '"' || char === "'"
          ? 'string'
          : char === '['
            ? 'array'
            : char === '{'
              ? 'object'
              : /[tf]/.test(char ?? '')
                ? 'boolean'
                : 'number';
      const mode = select(field, type);
      if (seen.has(JSON.stringify(field))) fail();
      seen.add(JSON.stringify(field));
      if (mode === 'value') {
        let value: Projection['value'];
        if (type === 'string') value = quoted(true);
        else {
          const token = /^(?:true|false|-?\d+(?:\.\d+)?)/.exec(text.slice(position))?.[0];
          if (!token) fail();
          position += token.length;
          value = JSON.parse(token);
        }
        projected.push({ path: field, value });
      } else {
        skipValue();
        if (mode === 'presence') projected.push({ path: field, value: 'Value hidden' });
      }
    }
    while (/[ \t\r]/.test(text[position] ?? '') && position < text.length) position++;
    if (text[position] === '#')
      while (position < text.length && text[position] !== '\n') position++;
    if (position < text.length && text[position] !== '\n') fail();
  }
  return projected;
}
