/**
 * Apple XML plist 子集解析器(手写、零依赖)。
 *
 * 支持的节点:dict / array / string / integer / real / true / false / data。
 * 覆盖 WGestures 1.8.5 config.plist(由 PlistCS 写出)的全部取值类型;
 * 处理 XML 声明、DOCTYPE、注释、实体转义与任意空白。
 */

export type PlistDict = { [key: string]: PlistValue };
export type PlistValue = string | number | boolean | Uint8Array | PlistValue[] | PlistDict;

export class PlistParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlistParseError";
  }
}

const WS = /[ \t\r\n]/;
const TAG_NAME = /^[A-Za-z_][A-Za-z0-9._-]*/;

/** 解析 XML plist 文本,返回根节点的值(通常为 dict)。 */
export function parsePlist(xml: string): PlistValue {
  return new Parser(xml).parseDocument();
}

class Parser {
  private pos = 0;
  private readonly src: string;

  constructor(src: string) {
    // 去除 BOM
    this.src = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  }

  parseDocument(): PlistValue {
    this.skipMisc();
    const save = this.pos;
    const tag = this.readTagOpen();
    let value: PlistValue;
    if (tag.name === "plist") {
      if (tag.selfClosing) this.fail("<plist> 元素为空");
      this.skipMisc();
      value = this.parseValue();
      this.skipMisc();
      this.expectClose("plist");
    } else {
      this.pos = save;
      value = this.parseValue();
    }
    this.skipMisc();
    if (this.pos < this.src.length) this.fail("文档结尾存在多余内容");
    return value;
  }

  private fail(msg: string): never {
    throw new PlistParseError(`${msg} (偏移 ${this.pos})`);
  }

  /** 跳过空白、XML 声明/处理指令、注释与 DOCTYPE */
  private skipMisc(): void {
    const s = this.src;
    for (;;) {
      while (this.pos < s.length && WS.test(s[this.pos]!)) this.pos++;
      if (s.startsWith("<?", this.pos)) {
        const end = s.indexOf("?>", this.pos);
        if (end < 0) this.fail("未闭合的处理指令");
        this.pos = end + 2;
      } else if (s.startsWith("<!--", this.pos)) {
        const end = s.indexOf("-->", this.pos);
        if (end < 0) this.fail("未闭合的注释");
        this.pos = end + 3;
      } else if (s.startsWith("<!", this.pos)) {
        // DOCTYPE(不支持内部子集)
        const end = s.indexOf(">", this.pos);
        if (end < 0) this.fail("未闭合的 DOCTYPE");
        this.pos = end + 1;
      } else {
        return;
      }
    }
  }

  private atClosingTag(): boolean {
    return this.src.startsWith("</", this.pos);
  }

  private readTagOpen(): { name: string; selfClosing: boolean } {
    const s = this.src;
    if (s[this.pos] !== "<") this.fail(`期望元素起始 '<',实际为 '${s[this.pos] ?? "EOF"}'`);
    this.pos++;
    const m = TAG_NAME.exec(s.slice(this.pos));
    if (!m) this.fail("非法的元素名");
    const name = m[0];
    this.pos += name.length;
    // 跳过属性(容忍引号中的 '>')
    while (this.pos < s.length) {
      const c = s[this.pos]!;
      if (c === '"' || c === "'") {
        const end = s.indexOf(c, this.pos + 1);
        if (end < 0) this.fail("未闭合的属性引号");
        this.pos = end + 1;
      } else if (c === ">") {
        this.pos++;
        return { name, selfClosing: false };
      } else if (c === "/" && s[this.pos + 1] === ">") {
        this.pos += 2;
        return { name, selfClosing: true };
      } else {
        this.pos++;
      }
    }
    this.fail(`元素 <${name}> 未闭合`);
  }

  private expectClose(name: string): void {
    const s = this.src;
    if (!s.startsWith("</", this.pos)) this.fail(`期望结束标签 </${name}>`);
    this.pos += 2;
    if (!s.startsWith(name, this.pos)) this.fail(`期望结束标签 </${name}>`);
    this.pos += name.length;
    while (this.pos < s.length && WS.test(s[this.pos]!)) this.pos++;
    if (s[this.pos] !== ">") this.fail(`结束标签 </${name}> 未闭合`);
    this.pos++;
  }

  /** 读取叶子元素的文本内容直至对应结束标签 */
  private readTextUntilClose(name: string): string {
    const idx = this.src.indexOf("<", this.pos);
    if (idx < 0) this.fail(`元素 <${name}> 缺少结束标签`);
    const text = this.src.slice(this.pos, idx);
    this.pos = idx;
    this.expectClose(name);
    return text;
  }

  private parseValue(): PlistValue {
    this.skipMisc();
    const { name, selfClosing } = this.readTagOpen();
    switch (name) {
      case "dict":
        return selfClosing ? {} : this.parseDictBody();
      case "array":
        return selfClosing ? [] : this.parseArrayBody();
      case "string":
        return selfClosing ? "" : decodeEntities(this.readTextUntilClose("string"));
      case "integer": {
        const text = (selfClosing ? "" : this.readTextUntilClose("integer")).trim();
        if (!/^[+-]?[0-9]+$/.test(text)) this.fail(`非法的 integer 值 "${text}"`);
        const value = Number.parseInt(text, 10);
        if (!Number.isSafeInteger(value)) this.fail(`integer 值超出安全范围 "${text}"`);
        return value;
      }
      case "real": {
        const text = (selfClosing ? "" : this.readTextUntilClose("real")).trim();
        if (!/^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$/.test(text)) {
          this.fail(`非法的 real 值 "${text}"`);
        }
        return Number.parseFloat(text);
      }
      case "true":
        if (!selfClosing && this.readTextUntilClose("true").trim() !== "") this.fail("<true> 不应包含内容");
        return true;
      case "false":
        if (!selfClosing && this.readTextUntilClose("false").trim() !== "") this.fail("<false> 不应包含内容");
        return false;
      case "data": {
        const text = selfClosing ? "" : this.readTextUntilClose("data");
        try {
          return decodeBase64(text);
        } catch (e) {
          this.fail(`非法的 data(base64)内容: ${(e as Error).message}`);
        }
      }
      // eslint-disable-next-line no-fallthrough
      case "key":
        this.fail("<key> 只允许出现在 <dict> 中");
      // eslint-disable-next-line no-fallthrough
      default:
        this.fail(`不支持的 plist 元素 <${name}>`);
    }
  }

  private parseDictBody(): PlistDict {
    const dict: PlistDict = {};
    for (;;) {
      this.skipMisc();
      if (this.atClosingTag()) {
        this.expectClose("dict");
        return dict;
      }
      const tag = this.readTagOpen();
      if (tag.name !== "key") this.fail(`<dict> 中期望 <key>,实际为 <${tag.name}>`);
      const key = tag.selfClosing ? "" : decodeEntities(this.readTextUntilClose("key"));
      this.skipMisc();
      if (this.atClosingTag() || this.pos >= this.src.length) {
        this.fail(`键 "${key}" 缺少对应的值`);
      }
      dict[key] = this.parseValue();
    }
  }

  private parseArrayBody(): PlistValue[] {
    const arr: PlistValue[] = [];
    for (;;) {
      this.skipMisc();
      if (this.atClosingTag()) {
        this.expectClose("array");
        return arr;
      }
      if (this.pos >= this.src.length) this.fail("<array> 缺少结束标签");
      arr.push(this.parseValue());
    }
  }
}

function decodeEntities(text: string): string {
  return text.replace(/&(?:#([0-9]+)|#[xX]([0-9A-Fa-f]+)|([A-Za-z]+));/g, (raw, dec, hex, named) => {
    if (dec !== undefined) return String.fromCodePoint(Number.parseInt(dec, 10));
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
    switch (named) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        throw new PlistParseError(`未知实体 ${raw}`);
    }
  });
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64_CHARS.length; i++) B64_LOOKUP[B64_CHARS[i]!] = i;

export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[ \t\r\n]/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error("含非法字符");
  const trimmed = clean.replace(/=+$/, "");
  if (trimmed.length % 4 === 1) throw new Error("长度非法");
  const out = new Uint8Array(Math.floor((trimmed.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 1 < trimmed.length; i += 4) {
    const n0 = B64_LOOKUP[trimmed[i]!]!;
    const n1 = B64_LOOKUP[trimmed[i + 1]!]!;
    out[o++] = (n0 << 2) | (n1 >> 4);
    if (i + 2 < trimmed.length) {
      const n2 = B64_LOOKUP[trimmed[i + 2]!]!;
      out[o++] = ((n1 & 0x0f) << 4) | (n2 >> 2);
      if (i + 3 < trimmed.length) {
        const n3 = B64_LOOKUP[trimmed[i + 3]!]!;
        out[o++] = ((n2 & 0x03) << 6) | n3;
      }
    }
  }
  return out.subarray(0, o);
}
