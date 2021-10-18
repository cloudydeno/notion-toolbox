export class CalendarObject {
  private readonly lines = new Array<string>();
  constructor(public readonly type: string) {
    this.lines.push(`BEGIN:${type}`);
  }
  datetime(key: string, value: Date, hasTime: boolean) {
    if (hasTime) {
      this.lines.push(`${key}:`+value.toISOString().replace(/([-:]|\.\d+)/g, ''));
    } else {
      this.lines.push(`${key};VALUE=DATE:`+value.toISOString().split('T')[0].replace(/-/g, ''));
    }
    return this;
  }
  string(key: string, value: string) {
    let fullText = `${key}:${escapeString(value)}`;
    this.lines.push(fullText);
    return this;
  }
  end() {
    this.lines.push(`END:${this.type}`);
    return this;
  }
  flush() {
    this.lines.push('');
    const finalLines = this.lines.flatMap(wrapString);
    this.lines.length = 0;
    return finalLines.join('\r\n');
  }
}

function escapeString(raw: string) {
  return raw
    .replace(/[\\,;]/g, x => `\\${x}`)
    .replace(/\r?\n/g, '\\n');
}

// TODO: should be 75 OCTETS, and thus handle multibyte
// and maybe something about escape sequences?
// possible reference: https://gist.github.com/hugowetterberg/81747
function wrapString(original: string) {
  const lines = [original.slice(0, 70)];
  let idx = lines[0].length;
  while (idx < original.length) {
    const nextLine = original.substr(idx, 69);
    idx += nextLine.length;
    lines.push(`\t${nextLine}`);
  }
  return lines;
}
