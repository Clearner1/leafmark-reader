import { Book, EpubCFI, type Contents, type Location, type NavItem, type Rendition } from "epubjs";
import type Section from "epubjs/types/section";

// Original adapter over public EPUB.js 0.3.93 APIs. No Obsidian reader plugin code is used.
// API references: https://github.com/futurepress/epub.js/tree/v0.3.93/types
// CFI parsing, archive resources, rendition navigation, and annotations remain upstream implementations.
export interface ChapterEntry {
  id: string;
  href: string;
  label: string;
  subitems: ChapterEntry[];
}

export interface ReaderHighlight {
  id: string;
  cfi: string;
  /** yellow, red, green, blue, purple, or an RGB/RRGGBB hex value. */
  color: string;
  thought?: string;
}

export interface ReaderAppearance {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  theme: "light" | "dark";
}

export interface ReaderLocation {
  cfi: string;
  chapter: string;
}

export interface ReaderSelection extends ReaderLocation {
  text: string;
  /** Visible selection bounds in the reader's top window, suitable for a fixed toolbar. */
  rect: DOMRect;
}

export interface ReaderCallbacks {
  onSelection?: (selection: ReaderSelection) => void;
  onLocation?: (location: ReaderLocation) => void;
  onHighlightClick?: (id: string) => void;
  onError?: (error: Error) => void;
}

const COLORS: Record<string, string> = {
  yellow: "#edc85b", red: "#ed8796", green: "#85c89b", blue: "#85b9ec", purple: "#b59ae0",
};

export function highlightColor(color: string): string {
  return COLORS[color] ?? (/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color) ? color : COLORS.yellow);
}

const CONTENT_POLICY = "default-src 'none'; script-src 'none'; connect-src 'none'; " +
  "img-src blob: data:; style-src 'unsafe-inline' blob:; font-src blob: data:; " +
  "media-src blob: data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function isExternalUrl(value: string): boolean {
  const normalized = value.replace(/[\u0000-\u0020\u007f]/g, "");
  return /^[a-z][a-z\d+.-]*:/i.test(normalized) || normalized.startsWith("//") || normalized.startsWith("\\");
}

/** Runs on the detached XML document, before any EPUB content reaches a live iframe. */
export function sanitizeBookDocument(document: Document): void {
  const removed = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "form", "input", "button", "textarea", "select", "foreignobject"]);
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    const name = element.localName.toLowerCase();
    if (removed.has(name) || (name === "meta" && element.hasAttribute("http-equiv"))) {
      element.remove();
      continue;
    }
    if (name === "link" && element.getAttribute("rel")?.toLowerCase() !== "stylesheet") {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const key = attribute.localName.toLowerCase();
      const value = attribute.value;
      if (key.startsWith("on") || ["srcdoc", "ping", "target", "download", "srcset", "autofocus", "autoplay"].includes(key)) {
        element.removeAttributeNode(attribute);
      } else if (["href", "src", "poster", "action", "formaction", "background"].includes(key) && isExternalUrl(value)) {
        // Inlined raster images are safe; all archive resources are replaced with blobs later by EPUB.js.
        const raster = key === "src" && name === "img" && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(value);
        if (!raster) element.removeAttributeNode(attribute);
      }
    }
  }
  let head = document.getElementsByTagName("head")[0];
  const namespace = "http://www.w3.org/1999/xhtml";
  if (!head) {
    head = document.createElementNS(namespace, "head") as HTMLHeadElement;
    document.documentElement.insertBefore(head, document.documentElement.firstChild);
  }
  const policy = document.createElementNS(namespace, "meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", CONTENT_POLICY);
  head.insertBefore(policy, head.firstChild);
}

function errorOf(value: unknown): Error {
  if (value instanceof Error) return value;
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return new Error(value.message);
  return new Error(String(value));
}

class ReaderBook extends Book {
  navigationError?: Error;

  override async loadNavigation(input: Parameters<Book["loadNavigation"]>[0]): Promise<Book["navigation"]> {
    try {
      return await super.loadNavigation(input);
    } catch (error) {
      // EPUB.js starts this promise without a rejection handler. Let its bookkeeping settle;
      // mount rethrows the recorded failure before using navigation or rendering the book.
      this.navigationError = errorOf(error);
      return this.navigation;
    }
  }
}

export class EpubEngine {
  private book?: Book;
  private openingBooks = new WeakSet<Book>();
  private rendition?: Rendition;
  private chapters: ChapterEntry[] = [];
  private highlights = new Map<string, ReaderHighlight>();
  private observer?: ResizeObserver;
  private viewport?: HTMLElement;
  private resizeFrame = 0;
  private size = { width: 0, height: 0 };
  private generation = 0;
  private disposed = false;
  private location?: ReaderLocation;
  private appearance: ReaderAppearance = {
    fontSize: 18, fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif', lineHeight: 1.85, theme: "light",
  };

  constructor(private readonly container: HTMLElement, private readonly callbacks: ReaderCallbacks = {}) {}

  async mount(bytes: ArrayBuffer, initialCfi?: string): Promise<void> {
    this.destroy();
    this.disposed = false;
    const generation = this.generation;
    const book = new ReaderBook({
      replacements: "blobUrl",
      requestMethod: async () => { throw new Error("电子书不能请求外部资源。"); },
    });
    this.book = book;
    this.openingBooks.add(book);
    book.spine.hooks.content.register(sanitizeBookDocument);
    try {
      await book.open(bytes, "binary");
      await Promise.all([book.opened, book.ready]);
      if (book.navigationError) throw book.navigationError;
      if (this.disposed || generation !== this.generation) {
        this.openingBooks.delete(book);
        book.destroy();
        return;
      }
      const fixedLayout = book.packaging.metadata.layout === "pre-paginated" ||
        (book as Book & { displayOptions?: { fixedLayout?: string } }).displayOptions?.fixedLayout === "true";
      let fixedSection = false;
      book.spine.each((section: Section) => {
        if (section.properties.includes("rendition:layout-pre-paginated")) fixedSection = true;
      });
      if (fixedLayout || fixedSection) throw new Error("这本书采用固定版式；当前阅读器支持可重排的 EPUB，请使用可重排版本。");

      const convert = (items: NavItem[]): ChapterEntry[] => items.filter(item => !isExternalUrl(item.href)).map(item => ({
        id: item.id, href: item.href, label: item.label.trim() || "未命名章节", subitems: convert(item.subitems ?? []),
      }));
      this.chapters = convert(book.navigation?.toc ?? []);
      if (!this.chapters.length) {
        book.spine.each((section: Section) => {
          if (section.linear) this.chapters.push({ id: section.idref, href: section.href, label: `第 ${this.chapters.length + 1} 节`, subitems: [] });
        });
      }
      // A replaced book may finish asynchronously; its detached host cannot overwrite the next book.
      const host = this.container.ownerDocument.createElement("div");
      host.style.width = "100%";
      host.style.height = "100%";
      this.container.append(host);
      const rendition = book.renderTo(host, {
        width: "100%", height: "100%", manager: "default", flow: "scrolled-doc", spread: "none",
        layout: "reflowable", allowScriptedContent: false, resizeOnOrientationChange: false,
      });
      this.rendition = rendition;
      rendition.on("attached", () => {
        if (this.disposed || generation !== this.generation) return;
        this.viewport = host.querySelector<HTMLElement>(".epub-container") ?? undefined;
        if (this.viewport) {
          // Keep the reading width stable when EPUB.js clears a chapter during reflow.
          this.viewport.style.scrollbarGutter = "stable";
          this.viewport.style.overflowY = "auto";
          this.viewport.style.overflowX = "auto";
          this.resizeToViewport();
        }
      });
      rendition.on("selected", (cfi: string, contents: Contents) => {
        if (generation === this.generation) this.selected(cfi, contents);
      });
      rendition.on("relocated", (location: Location) => {
        if (this.disposed || generation !== this.generation || !location?.start?.cfi) return;
        this.location = { cfi: location.start.cfi, chapter: this.chapterLabel(location.start.href) };
        this.callbacks.onLocation?.(this.location);
      });
      rendition.on("displayError", (error: unknown) => {
        if (!this.disposed && generation === this.generation) this.callbacks.onError?.(errorOf(error));
      });
      this.applyAppearance();
      await this.display(initialCfi && this.validCfi(initialCfi) ? initialCfi : undefined);
      this.openingBooks.delete(book);
      if (this.disposed || generation !== this.generation) {
        book.destroy();
        return;
      }
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.container);
      if (this.viewport) this.observer.observe(this.viewport);
      this.resize();
    } catch (error) {
      this.openingBooks.delete(book);
      if (!this.disposed && generation === this.generation) this.destroy();
      else book.destroy();
      throw errorOf(error);
    }
  }

  getToc(): ChapterEntry[] {
    return this.chapters;
  }

  async goToCFI(cfi: string): Promise<void> {
    this.requireRendition();
    if (!this.validCfi(cfi)) throw new Error("这条摘录的阅读位置无效。");
    await this.display(cfi);
  }

  async goToChapter(href: string): Promise<void> {
    if (isExternalUrl(href) || !this.book?.spine.get(href)) throw new Error("书中找不到这个章节。");
    await this.display(href);
  }

  async previous(): Promise<void> { await this.requireRendition().prev(); }
  async next(): Promise<void> { await this.requireRendition().next(); }

  setAppearance(appearance: Partial<ReaderAppearance>): void {
    this.appearance = { ...this.appearance, ...appearance };
    this.appearance.fontSize = Math.min(32, Math.max(12, Number(this.appearance.fontSize) || 18));
    this.appearance.lineHeight = Math.min(2.5, Math.max(1.3, Number(this.appearance.lineHeight) || 1.85));
    this.applyAppearance();
  }

  /** Updates overlays in place. Never redisplays a CFI or changes the current scroll position. */
  setHighlights(highlights: readonly ReaderHighlight[]): void {
    const rendition = this.requireRendition();
    const generation = this.generation;
    const desired = new Map(highlights.map(highlight => [highlight.cfi, highlight]));
    for (const [cfi, previous] of this.highlights) {
      const next = desired.get(cfi);
      if (!next || next.id !== previous.id || next.color !== previous.color || next.thought !== previous.thought) {
        rendition.annotations.remove(cfi, "highlight");
        this.highlights.delete(cfi);
      }
    }
    for (const [cfi, highlight] of desired) {
      if (this.highlights.has(cfi)) continue;
      if (!this.validCfi(cfi)) {
        this.callbacks.onError?.(new Error("有一条摘录的位置无效，已保留记录但未绘制高亮。"));
        continue;
      }
      try {
        rendition.annotations.highlight(cfi, { id: highlight.id }, () => {
          if (!this.disposed && generation === this.generation) this.callbacks.onHighlightClick?.(highlight.id);
        }, "epub-canvas-highlight", { fill: highlightColor(highlight.color), "fill-opacity": "0.33", "mix-blend-mode": "normal" });
        this.highlights.set(cfi, { ...highlight });
      } catch (error) {
        this.callbacks.onError?.(errorOf(error));
      }
    }
  }

  /** Returns null for an unrendered chapter; measuring a highlight must never navigate. */
  async getRangeRect(cfi: string): Promise<DOMRect | null> {
    if (!this.rendition || !this.validCfi(cfi)) return null;
    try {
      const range = this.rendition.getRange(cfi);
      return range ? this.rangeRect(range) : null;
    } catch { return null; }
  }

  clearSelection(): void {
    for (const frame of Array.from(this.container.querySelectorAll("iframe"))) frame.contentWindow?.getSelection()?.removeAllRanges();
  }

  resize(): void {
    const window = this.container.ownerDocument.defaultView;
    if (!window || this.resizeFrame || this.disposed) return;
    this.resizeFrame = window.requestAnimationFrame(() => {
      this.resizeFrame = 0;
      if (!this.rendition || this.disposed) return;
      const viewport = this.viewport ?? this.container;
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      if (!width || !height || (this.size.width === width && this.size.height === height)) return;
      this.size = { width, height };
      this.resizeToViewport();
    });
  }

  destroy(): void {
    this.disposed = true;
    this.generation++;
    this.observer?.disconnect();
    this.observer = undefined;
    this.viewport = undefined;
    if (this.resizeFrame) this.container.ownerDocument.defaultView?.cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = 0;
    // An in-flight archive open cannot be cancelled; mount releases it immediately after it settles.
    if (this.book && !this.openingBooks.has(this.book)) this.book.destroy();
    this.book = undefined;
    this.rendition = undefined;
    this.location = undefined;
    this.chapters = [];
    this.highlights.clear();
    this.size = { width: 0, height: 0 };
    this.container.replaceChildren();
  }

  private requireRendition(): Rendition {
    if (!this.rendition || this.disposed) throw new Error("电子书尚未加载完成。");
    return this.rendition;
  }

  private resizeToViewport(): void {
    if (!this.rendition) return;
    // Upstream supports omitted dimensions and measures its scroll area's clientWidth/clientHeight.
    // Its .d.ts incorrectly requires numbers; passing the outer pane's width includes the scrollbar.
    const resize = this.rendition.resize as (width?: number, height?: number) => void;
    resize.call(this.rendition);
  }

  private async display(target?: string): Promise<void> {
    const rendition = this.requireRendition();
    // EPUB.js emits displayError on some resource failures without rejecting its display promise.
    await new Promise<void>((resolve, reject) => {
      const failed = (error: unknown) => { rendition.off("displayError", failed); reject(errorOf(error)); };
      rendition.on("displayError", failed);
      rendition.display(target).then(() => {
        rendition.off("displayError", failed);
        resolve();
      }, failed);
    });
  }

  private validCfi(cfi: string): boolean {
    try {
      if (!new EpubCFI().isCfiString(cfi)) return false;
      return Boolean(this.book?.spine.get(cfi));
    } catch { return false; }
  }

  private chapterLabel(href: string): string {
    const key = href.split("#")[0];
    const find = (entries: ChapterEntry[]): string | undefined => {
      for (const entry of entries) {
        if (entry.href.split("#")[0] === key) return entry.label;
        const nested = find(entry.subitems);
        if (nested) return nested;
      }
      return undefined;
    };
    return find(this.chapters) ?? "正文";
  }

  private selected(cfi: string, contents: Contents): void {
    if (this.disposed) return;
    try {
      const range = contents.range(cfi);
      const text = range.toString().trim();
      const rect = this.rangeRect(range);
      if (!text || !rect) return;
      const chapter = this.book?.spine.get(contents.sectionIndex);
      this.callbacks.onSelection?.({ cfi, text, chapter: this.chapterLabel(chapter?.href ?? ""), rect });
    } catch (error) { this.callbacks.onError?.(errorOf(error)); }
  }

  private rangeRect(range: Range): DOMRect | null {
    let window = range.startContainer.ownerDocument?.defaultView;
    if (!window) return null;
    let offsetX = 0;
    let offsetY = 0;
    let scaleX = 1;
    let scaleY = 1;
    while (window.frameElement) {
      const frame = window.frameElement as HTMLElement;
      const bounds = frame.getBoundingClientRect();
      const frameScaleX = frame.offsetWidth ? bounds.width / frame.offsetWidth : 1;
      const frameScaleY = frame.offsetHeight ? bounds.height / frame.offsetHeight : 1;
      offsetX = bounds.left + (offsetX + frame.clientLeft) * frameScaleX;
      offsetY = bounds.top + (offsetY + frame.clientTop) * frameScaleY;
      scaleX *= frameScaleX;
      scaleY *= frameScaleY;
      window = frame.ownerDocument.defaultView!;
    }
    const viewport = this.container.getBoundingClientRect();
    const rectangles = Array.from(range.getClientRects()).map(rect => ({
      left: offsetX + rect.left * scaleX, right: offsetX + rect.right * scaleX,
      top: offsetY + rect.top * scaleY, bottom: offsetY + rect.bottom * scaleY,
    })).filter(rect => rect.right > rect.left && rect.bottom > rect.top && rect.bottom > viewport.top && rect.top < viewport.bottom && rect.right > viewport.left && rect.left < viewport.right);
    if (!rectangles.length) return null;
    const left = Math.max(viewport.left, Math.min(...rectangles.map(rect => rect.left)));
    const top = Math.max(viewport.top, Math.min(...rectangles.map(rect => rect.top)));
    const right = Math.min(viewport.right, Math.max(...rectangles.map(rect => rect.right)));
    const bottom = Math.min(viewport.bottom, Math.max(...rectangles.map(rect => rect.bottom)));
    return new DOMRect(left, top, right - left, bottom - top);
  }

  private applyAppearance(): void {
    if (!this.rendition) return;
    const { fontSize, fontFamily, lineHeight, theme } = this.appearance;
    const dark = theme === "dark";
    this.rendition.themes.default({
      html: {
        "background-color": `${dark ? "#202124" : "#fff"} !important`, "color-scheme": dark ? "dark" : "light",
        "font-size": `${fontSize}px !important`, "max-width": "100% !important",
      },
      body: {
        color: `${dark ? "#e3e2de" : "#292a2b"} !important`, "background-color": `${dark ? "#202124" : "#fff"} !important`,
        "font-family": `${fontFamily} !important`, "font-size": `${fontSize}px !important`, "line-height": `${lineHeight} !important`,
        "overflow-wrap": "anywhere", "padding": "24px 24px 64px !important", "box-sizing": "border-box !important",
        "width": "100% !important", "max-width": "100% !important", "margin": "0 !important",
      },
      "p, li, blockquote, dd, dt": {
        "font-size": `${fontSize}px !important`, "line-height": `${lineHeight} !important`, color: "inherit !important",
        "overflow-wrap": "anywhere !important",
      },
      "p span, li span, blockquote span, dd span, dt span": { "font-size": "inherit !important" },
      "h1, h2, h3, h4, h5, h6, span": { color: "inherit !important" },
      "h1, h2, h3, h4, h5, h6": { "white-space": "normal !important", "overflow-wrap": "anywhere !important" },
      "img, svg, video": { "max-width": "100% !important", height: "auto !important", "object-fit": "contain" },
      "pre": { "white-space": "pre-wrap !important", "overflow-wrap": "anywhere" },
      "a": { color: `${dark ? "#98bbec" : "#386a99"} !important` },
    });
  }
}
