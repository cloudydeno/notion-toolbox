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
    this.lines.push(`${key}:${escapeString(value)}`);
    return this;
  }
  end() {
    this.lines.push(`END:${this.type}`);
    return this;
  }
  flush() {
    const data = this.lines.join('\n');
    this.lines.length = 0;
    return data+'\n\n';
  }
}

function escapeString(raw: string) {
  return raw
    .replace(/[\\,;]/g, x => `\\${x}`)
    .replace(/\r?\n/g, '\\n');
}
