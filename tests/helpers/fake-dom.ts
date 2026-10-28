/**
 * A very small DOM double for client act tests (vitest runs in node, with no DOM library).
 * Elements have ids, data-* (as `dataset`), attributes, field values and dialogs, and answer
 * simple selectors: `tag`, `#id`, `[attr]`, `[attr="v"]`, `:checked`, combined, comma-separated.
 */

type Child = FakeEl | string;

const DATA = /^data-/;

function camel(name: string): string {
  return name.replace(/^data-/, "").replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function kebab(key: string): string {
  return `data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

type Part = { tag?: string; id?: string; attrs: [string, string | null][]; checked: boolean };

function parse(selector: string): Part[] {
  return selector.split(",").map((raw) => {
    let rest = raw.trim();
    const part: Part = { attrs: [], checked: false };
    const tag = /^[a-zA-Z][a-zA-Z0-9]*/.exec(rest);
    if (tag) {
      part.tag = tag[0].toUpperCase();
      rest = rest.slice(tag[0].length);
    }
    while (rest) {
      const id = /^#([\w-]+)/.exec(rest);
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest);
      if (id) {
        part.id = id[1];
        rest = rest.slice(id[0].length);
      } else if (attr) {
        part.attrs.push([attr[1], attr[2] ?? null]);
        rest = rest.slice(attr[0].length);
      } else if (rest.startsWith(":checked")) {
        part.checked = true;
        rest = rest.slice(8);
      } else {
        throw new Error(`fake-dom: unsupported selector ${raw}`);
      }
    }
    return part;
  });
}

export class FakeEl {
  tagName: string;
  id = "";
  dataset: Record<string, string> = {};
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  attrs = new Map<string, string>();
  text = "";
  type?: string;
  name?: string;
  value = "";
  checked = false;
  files: { length: number } | null = null;
  open = false;
  focused = false;
  clicks = 0;
  events: string[] = [];
  onclick: (() => void) | null = null;

  constructor(tag: string, attrs: Record<string, string | boolean> = {}, children: Child[] = []) {
    this.tagName = tag.toUpperCase();
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "checked") this.checked = Boolean(value);
      else if (key === "value") this.value = String(value);
      else this.setAttribute(key, String(value));
    }
    if (this.tagName === "INPUT" && !this.type) this.type = "text";
    for (const child of children) {
      if (typeof child === "string") this.text += child;
      else {
        child.parentElement = this;
        this.children.push(child);
      }
    }
  }

  setAttribute(name: string, value: string) {
    if (name === "id") this.id = value;
    else if (name === "type") this.type = value;
    else if (name === "name") this.name = value;
    else if (DATA.test(name)) this.dataset[camel(name)] = value;
    else this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    if (name === "id") return this.id || null;
    if (name === "type") return this.type ?? null;
    if (name === "name") return this.name ?? null;
    if (DATA.test(name)) return this.dataset[camel(name)] ?? null;
    return this.attrs.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }

  removeAttribute(name: string) {
    if (DATA.test(name)) delete this.dataset[camel(name)];
    else this.attrs.delete(name);
  }

  get max(): string {
    return this.attrs.get("max") ?? "";
  }

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }

  get selectedOptions(): FakeEl[] {
    return this.children.filter((child) => child.tagName === "OPTION" && child.value === this.value);
  }

  *all(): Generator<FakeEl> {
    for (const child of this.children) {
      yield child;
      yield* child.all();
    }
  }

  matches(selector: string): boolean {
    return parse(selector).some(
      (part) =>
        (!part.tag || part.tag === this.tagName) &&
        (!part.id || part.id === this.id) &&
        (!part.checked || this.checked) &&
        part.attrs.every(([name, value]) => (value === null ? this.hasAttribute(name) : this.getAttribute(name) === value)),
    );
  }

  querySelectorAll(selector: string): FakeEl[] {
    return [...this.all()].filter((node) => node.matches(selector));
  }

  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  closest(selector: string): FakeEl | null {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }

  contains(node: FakeEl | null): boolean {
    for (let item = node; item; item = item.parentElement) if (item === this) return true;
    return false;
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }

  focus() {
    this.focused = true;
  }

  click() {
    this.clicks += 1;
    this.onclick?.();
  }

  dispatchEvent(event: Event): boolean {
    this.events.push(event.type);
    return true;
  }

  /** The attribute name a dataset key is written as. */
  static attr(key: string): string {
    return kebab(key);
  }
}

export function h(tag: string, attrs: Record<string, string | boolean> = {}, ...children: Child[]): FakeEl {
  return new FakeEl(tag, attrs, children);
}

/** A sessionStorage double. */
export class FakeStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}
