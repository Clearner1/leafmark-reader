// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { Document as HappyDocument, PropertySymbol, Window } from "happy-dom";
import { Book, EpubCFI, type Rendition } from "epubjs";
import { EpubEngine, highlightColor, sanitizeBookDocument } from "../src/engine";

const cfi = "epubcfi(/6/2[chapter]!/4/2/1:0)";
let createDivDescriptor: PropertyDescriptor | undefined;
beforeAll(() => {
  createDivDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "createDiv");
  Object.defineProperty(HTMLElement.prototype, "createDiv", { configurable: true, writable: true, value(this: HTMLElement, options: { cls?: string; attr?: Record<string, string> } = {}) {
    const element = this.ownerDocument.createElement("div");
    if (options.cls) element.className = options.cls;
    for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, value);
    this.append(element);
    return element;
  } });
});
afterAll(() => {
  if (createDivDescriptor) Object.defineProperty(HTMLElement.prototype, "createDiv", createDivDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "createDiv");
});
const createRange = HappyDocument.prototype.createRange;
beforeEach(() => {
  // happy-dom binds XML ranges to the window document; keep detached EPUB ranges in their owning document.
  vi.spyOn(HappyDocument.prototype, "createRange").mockImplementation(function (this: Document) {
    const range = createRange.call(this);
    const internals = range as unknown as {
      [PropertySymbol.ownerDocument]: Document;
      [PropertySymbol.start]: { node: Node; offset: number };
      [PropertySymbol.end]: { node: Node; offset: number };
    };
    internals[PropertySymbol.ownerDocument] = this;
    internals[PropertySymbol.start] = { node: this, offset: 0 };
    internals[PropertySymbol.end] = { node: this, offset: 0 };
    return range;
  });
});
afterEach(() => vi.restoreAllMocks());

describe("detached EPUB content security", () => {
  it("removes active markup and remote URLs before serialization, keeping local book assets", () => {
    const isolated = new Window({ settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true, enableJavaScriptEvaluation: false } });
    const xml = new isolated.DOMParser().parseFromString(`<html xmlns="http://www.w3.org/1999/xhtml"><head>
      <meta http-equiv="refresh" content="0;url=https://example.com"/>
      <link rel="preconnect" href="https://example.com"/>
      <link rel="stylesheet" href="../Styles/book.css"/>
      <script>window.compromised=true</script></head><body onload="alert(1)">
      <p id="text">A readable passage</p><img src="../Images/cover.jpg" onerror="alert(1)"/>
      <img id="remote" src="https://example.com/track" srcset="https://example.com/track 2x"/>
      <a id="external" href="java script:alert(1)" ping="https://example.com">unsafe</a>
      <a id="local" href="chapter2.xhtml#target">next</a>
      <iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"/><form action="https://example.com"><input/></form>
      <svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject>unsafe</foreignObject></svg>
      </body></html>`, "application/xhtml+xml") as unknown as Document;
    sanitizeBookDocument(xml);
    expect(xml.querySelector("parsererror")).toBeNull();
    expect(xml.querySelector("script, iframe, form, input, foreignObject")).toBeNull();
    expect(xml.querySelector("[onload], [onerror], [ping], [srcset]")).toBeNull();
    expect(xml.querySelector("#remote")?.hasAttribute("src")).toBe(false);
    expect(xml.querySelector("#external")?.hasAttribute("href")).toBe(false);
    expect(xml.querySelector("#local")?.getAttribute("href")).toBe("chapter2.xhtml#target");
    expect(xml.querySelector("img")?.getAttribute("src")).toBe("../Images/cover.jpg");
    expect(xml.querySelector("link")?.getAttribute("href")).toBe("../Styles/book.css");
    const first = xml.querySelector("head")?.firstElementChild;
    expect(first?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(first?.getAttribute("content")).toContain("script-src 'none'");
    expect(first?.getAttribute("content")).toContain("connect-src 'none'");
    expect(first?.getAttribute("content")).not.toContain("https:");
    sanitizeBookDocument(xml);
    expect(xml.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).toHaveLength(1);
    expect(xml.querySelector("#text")?.textContent).toBe("A readable passage");
  });

  it("limits annotation colors to the palette or hex values", () => {
    expect(highlightColor("purple")).toBe("#b59ae0");
    expect(highlightColor("#abc")).toBe("#abc");
    expect(highlightColor("url(https://example.com) ")).toBe(highlightColor("yellow"));
  });
});

function mountedDouble(container = document.createElement("div")) {
  const callbacks = { onHighlightClick: vi.fn(), onError: vi.fn() };
  const engine = new EpubEngine(container, callbacks);
  const rendition = {
    annotations: { highlight: vi.fn(), remove: vi.fn() }, display: vi.fn(), getRange: vi.fn(), resize: vi.fn(),
  };
  Object.assign(engine, { rendition, book: { spine: { get: () => ({ href: "chapter.xhtml" }) }, destroy: vi.fn() } });
  return { engine, rendition, callbacks };
}

function searchDouble(sections: ReturnType<typeof searchSection>[]) {
  const { engine, ...rest } = mountedDouble();
  const book = { spine: { each: (visit: (section: unknown) => void) => sections.forEach(visit) }, load: vi.fn(), destroy: vi.fn() };
  Object.assign(engine, { book });
  return { engine, book, ...rest };
}

function searchSection(index: number, href = `chapter${index}.xhtml`, markup = `<p>Needle in chapter ${index}</p>`) {
  const document = new DOMParser().parseFromString(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body>${markup}</body></html>`, "application/xhtml+xml");
  return { index, href, document: document as Document | undefined, load: vi.fn().mockResolvedValue(document.documentElement), cfiFromRange: vi.fn((_range: Range) => `${cfi}-${index}`), unload: vi.fn() };
}

describe("whole-book search", () => {
  it("searches chapters in order, binds the archive loader, and resolves nested chapter titles", async () => {
    const sections = [searchSection(0), searchSection(1), searchSection(2)];
    const { engine, book } = searchDouble(sections);
    Object.assign(engine, { chapters: [{ id: "parent", href: "chapter0.xhtml#start", label: "First chapter", subitems: [{ id: "child", href: "chapter1.xhtml#heading", label: "Nested chapter", subitems: [] }] }] });
    const events: string[] = [];
    book.load.mockImplementation(function (this: unknown) { expect(this).toBe(book); return Promise.resolve(); });
    for (const section of sections) {
      section.load.mockImplementation(async request => { events.push(`load ${section.index}`); await request(section.href); });
      section.cfiFromRange.mockImplementation(range => { expect(range.toString()).toBe("Needle"); events.push(`range ${section.index}`); return `${cfi}-${section.index}`; });
      section.unload.mockImplementation(() => { events.push(`unload ${section.index}`); });
    }
    expect(await engine.search("  Needle  ")).toEqual({ hits: [
      { cfi: `${cfi}-0`, excerpt: "Needle in chapter 0", chapter: "First chapter", sectionHref: "chapter0.xhtml", sectionIndex: 0 },
      { cfi: `${cfi}-1`, excerpt: "Needle in chapter 1", chapter: "Nested chapter", sectionHref: "chapter1.xhtml", sectionIndex: 1 },
      { cfi: `${cfi}-2`, excerpt: "Needle in chapter 2", chapter: "正文", sectionHref: "chapter2.xhtml", sectionIndex: 2 },
    ], failedSections: 0 });
    expect(events).toEqual(["load 0", "range 0", "unload 0", "load 1", "range 1", "unload 1", "load 2", "range 2", "unload 2"]);
    expect(book.load).toHaveBeenCalledTimes(3);
  });

  it("creates exact ranges and plain-text excerpts for repeated matches across nested inline tags", async () => {
    const section = searchSection(0, undefined, '<p>前言：真正的<strong>意识</strong>值得探索。真正的<em><span>意</span><a href="#">识</a></em>在此。</p>');
    const doc = section.document!;
    const paragraph = doc.querySelector("p")!;
    const createRange = vi.spyOn(doc, "createRange");
    const { engine } = searchDouble([section]);
    const result = await engine.search("真正的意识");
    expect(result.failedSections).toBe(0);
    expect(result.hits).toHaveLength(2);
    expect(createRange).toHaveBeenCalledTimes(2);
    expect(result.hits.map(hit => hit.cfi)).toEqual([`${cfi}-0`, `${cfi}-0`]);
    for (const hit of result.hits) {
      expect(hit.excerpt).toContain("前言：真正的意识值得探索。真正的意识在此。");
      expect(hit.excerpt).not.toMatch(/<(?:strong|em|span|a)\b/);
    }
    const [first, second] = section.cfiFromRange.mock.calls.map(([range]) => range);
    expect(first.startContainer).toBe(paragraph.firstChild);
    expect(first.startOffset).toBe(3);
    expect(first.endContainer).toBe(paragraph.querySelector("strong")!.firstChild);
    expect(first.endOffset).toBe(2);
    expect(second.startContainer).toBe(paragraph.childNodes[2]);
    expect(second.startOffset).toBe(5);
    expect(second.endContainer).toBe(paragraph.querySelector("a")!.firstChild);
    expect(second.endOffset).toBe(1);
    expect([first.toString(), second.toString()]).toEqual(["真正的意识", "真正的意识"]);
  });

  it("finds every case-insensitive occurrence within one text node with distinct offsets", async () => {
    const section = searchSection(0, undefined, "<p>Needle needle NEEDLE</p>");
    const { engine } = searchDouble([section]);
    const result = await engine.search("needle");
    expect(result.hits).toHaveLength(3);
    expect(section.cfiFromRange.mock.calls.map(([range]) => [range.startOffset, range.endOffset, range.toString()])).toEqual([
      [0, 6, "Needle"], [7, 13, "needle"], [14, 20, "NEEDLE"],
    ]);
  });

  it("searches literal punctuation and preserves source offsets after Unicode case expansion", async () => {
    const section = searchSection(0, undefined, "<p>İ a+b and <strong>a+</strong><span>b</span>.</p>");
    const { engine } = searchDouble([section]);
    expect((await engine.search("a+b")).hits).toHaveLength(2);
    const ranges = section.cfiFromRange.mock.calls.map(([range]) => range);
    expect(ranges.map(range => range.toString())).toEqual(["a+b", "a+b"]);
    expect(ranges[0].startOffset).toBe(2);
    expect(ranges[0].endOffset).toBe(5);
    expect(ranges[1].startOffset).toBe(0);
    expect(ranges[1].endOffset).toBe(1);
  });

  it("matches at inline-node boundaries without spanning separate blocks or line breaks", async () => {
    const section = searchSection(0, undefined, "<p>真正的</p><p>意识</p><div>真正的<span>意识</span></div><div>真正的<br/>意识</div><div>真正的<div>意识</div></div>");
    const { engine } = searchDouble([section]);
    const result = await engine.search("真正的意识");
    expect(result.hits).toHaveLength(1);
    const range = section.cfiFromRange.mock.calls[0][0];
    expect(range.startOffset).toBe(0);
    expect(range.endOffset).toBe(2);
    expect(range.toString()).toBe("真正的意识");
    expect(range.startContainer.parentElement?.localName).toBe("div");
    expect(range.endContainer.parentElement?.localName).toBe("span");
  });

  it("does not search document metadata, scripts, or styles", async () => {
    const section = searchSection(0, undefined, "<style>needle</style><script>needle</script><p>Readable needle.</p>");
    section.document!.querySelector("title")!.textContent = "needle";
    const { engine } = searchDouble([section]);
    expect((await engine.search("needle")).hits).toHaveLength(1);
    expect(section.cfiFromRange.mock.calls[0][0].startContainer.parentElement?.localName).toBe("p");
  });

  it("releases failed chapters and reports incomplete results after loading or searching errors", async () => {
    const sections = [searchSection(0), searchSection(1), searchSection(2), searchSection(3)];
    sections[0].load.mockRejectedValue(new Error("Missing chapter"));
    sections[1].cfiFromRange.mockImplementation(() => { throw new Error("Invalid chapter"); });
    sections[2].unload.mockImplementation(() => { throw new Error("Release failed"); });
    const { engine } = searchDouble(sections);
    const result = await engine.search("needle");
    expect(result.hits.map(hit => hit.sectionIndex)).toEqual([2, 3]);
    expect(result.failedSections).toBe(2);
    expect(sections[0].cfiFromRange).not.toHaveBeenCalled();
    for (const section of sections) expect(section.unload).toHaveBeenCalledTimes(1);
  });

  it("reports incomplete search even when readable chapters have no matches", async () => {
    const sections = [searchSection(0), searchSection(1, undefined, "<p>No matching text.</p>")];
    sections[0].load.mockRejectedValue(new Error("Missing chapter"));
    const { engine } = searchDouble(sections);
    expect(await engine.search("needle")).toEqual({ hits: [], failedSections: 1 });
    for (const section of sections) expect(section.unload).toHaveBeenCalledTimes(1);
  });

  it("rejects with a localizable error when every chapter fails", async () => {
    const sections = [searchSection(0), searchSection(1)];
    for (const section of sections) section.load.mockRejectedValue(new Error("Missing chapter"));
    const { engine } = searchDouble(sections);
    await expect(engine.search("needle")).rejects.toThrow("无法读取任何章节，全文搜索失败。");
    for (const section of sections) expect(section.unload).toHaveBeenCalledTimes(1);
  });

  it("counts a missing parsed document as a chapter failure instead of an empty result", async () => {
    const section = searchSection(0);
    section.document = undefined;
    const { engine } = searchDouble([section]);
    await expect(engine.search("needle")).rejects.toThrow("无法读取任何章节，全文搜索失败。");
    expect(section.unload).toHaveBeenCalledTimes(1);
  });

  it("counts XML parse errors as chapter failures", async () => {
    const section = searchSection(0);
    section.document!.querySelector("body")!.append(section.document!.createElement("parsererror"));
    const { engine } = searchDouble([section]);
    await expect(engine.search("needle")).rejects.toThrow("无法读取任何章节，全文搜索失败。");
    expect(section.cfiFromRange).not.toHaveBeenCalled();
    expect(section.unload).toHaveBeenCalledTimes(1);
  });

  it("discards an entire chapter when a later match cannot be converted to a CFI", async () => {
    const sections = [searchSection(0, undefined, "<p>needle needle</p>"), searchSection(1)];
    sections[0].cfiFromRange.mockReturnValueOnce("partial-cfi").mockImplementationOnce(() => { throw new Error("Broken CFI"); });
    const { engine } = searchDouble(sections);
    const result = await engine.search("needle");
    expect(result.failedSections).toBe(1);
    expect(result.hits.map(hit => hit.sectionIndex)).toEqual([1]);
    for (const section of sections) expect(section.unload).toHaveBeenCalledTimes(1);
  });

  it("finds overlapping matches across inline text nodes", async () => {
    const section = searchSection(0, undefined, "<p>ba<strong>na</strong>na</p>");
    const { engine } = searchDouble([section]);
    expect((await engine.search("ana")).hits).toHaveLength(2);
    expect(section.cfiFromRange.mock.calls.map(([range]) => range.toString())).toEqual(["ana", "ana"]);
  });

  it("does not load chapters for blank queries or a closed book", async () => {
    const section = searchSection(0);
    const { engine } = searchDouble([section]);
    expect(await engine.search(" \n\t ")).toEqual({ hits: [], failedSections: 0 });
    engine.destroy();
    expect(await engine.search("needle")).toEqual({ hits: [], failedSections: 0 });
    expect(section.load).not.toHaveBeenCalled();
    expect(await new EpubEngine(document.createElement("div")).search("needle")).toEqual({ hits: [], failedSections: 0 });
  });

  it.each(["disposed", "generation"])("discards results and releases the loading chapter when %s changes", async reason => {
    const sections = [searchSection(0), searchSection(1)];
    let finishLoad!: () => void;
    sections[0].load.mockReturnValue(new Promise<void>(resolve => { finishLoad = resolve; }));
    const { engine } = searchDouble(sections);
    const pending = engine.search("needle");
    if (reason === "disposed") engine.destroy();
    else Object.assign(engine, { generation: 1 });
    finishLoad();
    expect(await pending).toEqual({ hits: [], failedSections: 0 });
    expect(sections[0].cfiFromRange).not.toHaveBeenCalled();
    expect(sections[0].unload).toHaveBeenCalledTimes(1);
    expect(sections[1].load).not.toHaveBeenCalled();
  });

  it("discards a load rejection after cancellation without reporting all chapters failed", async () => {
    const section = searchSection(0);
    let rejectLoad!: (reason: Error) => void;
    section.load.mockReturnValue(new Promise<void>((_resolve, reject) => { rejectLoad = reject; }));
    const { engine } = searchDouble([section]);
    const pending = engine.search("needle");
    engine.destroy();
    rejectLoad(new Error("Cancelled chapter"));
    expect(await pending).toEqual({ hits: [], failedSections: 0 });
    expect(section.unload).toHaveBeenCalledTimes(1);
  });

  it("finds every occurrence across real archive chapters, round-trips cross-inline CFIs, and unloads documents", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file("META-INF/container.xml", `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
    zip.file("package.opf", `<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">search-test</dc:identifier><dc:title>Search</dc:title><dc:language>en</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`);
    zip.file("one.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>First</title></head><body><p>Needle, then another NEEDLE.</p><p>前文：真正的<strong>意识</strong>与真正的<em>意识</em>。</p></body></html>`);
    zip.file("two.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Second</title></head><body><p>A final needle.</p><script>needle</script></body></html>`);
    const rendition = { on: vi.fn(), off: vi.fn(), themes: { default: vi.fn() }, display: vi.fn().mockResolvedValue(undefined), resize: vi.fn() };
    vi.spyOn(Book.prototype, "renderTo").mockReturnValue(rendition as unknown as Rendition);
    const engine = new EpubEngine(document.createElement("div"));
    await engine.mount(await zip.generateAsync({ type: "arraybuffer" }));
    const { hits, failedSections } = await engine.search("needle");
    expect(failedSections).toBe(0);
    expect(hits.map(hit => hit.sectionIndex)).toEqual([0, 0, 1]);
    expect(hits.map(hit => hit.chapter)).toEqual(["第 1 节", "第 1 节", "第 2 节"]);
    expect(new Set(hits.map(hit => hit.cfi)).size).toBe(3);
    const inline = await engine.search("真正的意识");
    expect(inline.failedSections).toBe(0);
    expect(inline.hits).toHaveLength(2);
    expect(new Set(inline.hits.map(hit => hit.cfi)).size).toBe(2);
    expect(inline.hits[0].excerpt).toContain("前文：真正的意识与真正的意识。");
    const book = (engine as unknown as { book: Book }).book;
    book.spine.each((section: { document?: Document; contents?: Element }) => {
      expect(section.document).toBeUndefined();
      expect(section.contents).toBeUndefined();
    });
    const section = book.spine.get(0);
    await section.load(book.load.bind(book));
    for (const hit of inline.hits) {
      const range = new EpubCFI(hit.cfi).toRange(section.document);
      expect(range.toString()).toBe("真正的意识");
      expect(range.startContainer.nodeType).toBe(Node.TEXT_NODE);
      expect(range.endContainer.nodeType).toBe(Node.TEXT_NODE);
    }
    section.unload();
    engine.destroy();
  });
});

describe("temporary search highlight", () => {
  function highlightedDouble() {
    const container = document.createElement("div");
    const paragraph = container.ownerDocument.createElement("p");
    paragraph.textContent = "A matching passage over two lines.";
    container.append(paragraph);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 200, 100));
    const range = container.ownerDocument.createRange();
    range.selectNodeContents(paragraph);
    const rectangles = vi.spyOn(range, "getClientRects").mockReturnValue([new DOMRect(20, 30, 70, 18), new DOMRect(20, 48, 50, 18)] as unknown as DOMRectList);
    const result = mountedDouble(container);
    result.rendition.getRange.mockReturnValue(range);
    return { ...result, container, rectangles };
  }

  it("draws independent rectangles at the same CFI as an excerpt, replacing and clearing only search overlays", () => {
    const { engine, rendition, callbacks, container } = highlightedDouble();
    const userHighlight = { id: "one", cfi, color: "yellow" };
    engine.setHighlights([userHighlight]);
    engine.setSearchHighlight(cfi);
    const first = container.querySelector(".lm-search-highlight")!;
    expect(first.getAttribute("aria-hidden")).toBe("true");
    const marks = first.querySelectorAll<HTMLElement>(".lm-search-highlight-fragment");
    expect(marks).toHaveLength(2);
    expect(marks[0].style.left).toBe("10px");
    expect(marks[0].style.top).toBe("10px");
    expect(marks[0].style.width).toBe("70px");
    expect(marks[1].style.top).toBe("28px");
    engine.setSearchHighlight("epubcfi(/6/2[chapter]!/4/2/1:5)");
    expect(first.parentElement).toBeNull();
    expect(container.querySelectorAll(".lm-search-highlight")).toHaveLength(1);
    engine.setSearchHighlight();
    expect(container.querySelector(".lm-search-highlight")).toBeNull();
    engine.setHighlights([userHighlight]);
    expect(rendition.annotations.highlight).toHaveBeenCalledTimes(1);
    expect(rendition.annotations.remove).not.toHaveBeenCalled();
    rendition.annotations.highlight.mock.calls[0][2]();
    expect(callbacks.onHighlightClick).toHaveBeenCalledWith("one");
    expect(rendition.display).not.toHaveBeenCalled();
  });

  it("keeps the search overlay when excerpts change and updates its position on scroll", () => {
    const { engine, rendition, container, rectangles } = highlightedDouble();
    engine.setHighlights([{ id: "one", cfi, color: "yellow" }]);
    engine.setSearchHighlight(cfi);
    engine.setHighlights([]);
    expect(rendition.annotations.remove).toHaveBeenCalledWith(cfi, "highlight");
    expect(container.querySelector(".lm-search-highlight-fragment")).not.toBeNull();
    rectangles.mockReturnValue([new DOMRect(20, 25, 70, 18)] as unknown as DOMRectList);
    container.dispatchEvent(new Event("scroll"));
    expect(container.querySelector<HTMLElement>(".lm-search-highlight-fragment")?.style.top).toBe("5px");
    engine.setSearchHighlight();
  });

  it("clears the overlay and detaches its listeners on destroy", () => {
    const { engine, rendition, container } = highlightedDouble();
    engine.setSearchHighlight(cfi);
    engine.destroy();
    const calls = rendition.getRange.mock.calls.length;
    container.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(rendition.getRange).toHaveBeenCalledTimes(calls);
    expect(container.querySelector(".lm-search-highlight")).toBeNull();
    expect(() => engine.setSearchHighlight()).not.toThrow();
  });
});

describe("annotation persistence", () => {
  it("redraws changed overlays without navigating or redrawing unchanged highlights", () => {
    const { engine, rendition, callbacks } = mountedDouble();
    const first = { id: "one", cfi, color: "yellow" };
    engine.setHighlights([first]);
    engine.setHighlights([{ ...first }]);
    expect(rendition.annotations.highlight).toHaveBeenCalledTimes(1);
    rendition.annotations.highlight.mock.calls[0][2]();
    expect(callbacks.onHighlightClick).toHaveBeenCalledWith("one");
    engine.setHighlights([{ ...first, thought: "My thought", color: "blue" }]);
    expect(rendition.annotations.remove).toHaveBeenCalledWith(cfi, "highlight");
    expect(rendition.annotations.highlight).toHaveBeenCalledTimes(2);
    engine.setHighlights([]);
    expect(rendition.annotations.remove).toHaveBeenCalledTimes(2);
    expect(rendition.display).not.toHaveBeenCalled();
  });

  it("does not navigate when a range is in an unrendered chapter", async () => {
    const { engine, rendition } = mountedDouble();
    rendition.getRange.mockReturnValue(undefined);
    expect(await engine.getRangeRect(cfi)).toBeNull();
    expect(rendition.display).not.toHaveBeenCalled();
  });

  it("measures the range's own iframe rather than the first frame", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const first = document.createElement("iframe");
    const second = document.createElement("iframe");
    container.append(first, second);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(80, 150, 600, 700));
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 600));
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 200, 400, 600));
    Object.defineProperties(second, { offsetWidth: { value: 400 }, offsetHeight: { value: 600 } });
    // happy-dom does not wire frameElement; browsers do.
    Object.defineProperty(second.contentDocument!.defaultView!, "frameElement", { value: second });
    const paragraph = second.contentDocument!.createElement("p");
    paragraph.textContent = "selected text";
    second.contentDocument!.body.append(paragraph);
    const range = second.contentDocument!.createRange();
    range.selectNodeContents(paragraph);
    vi.spyOn(range, "getClientRects").mockReturnValue([new DOMRect(20, 30, 120, 24)] as unknown as DOMRectList);
    const { engine, rendition } = mountedDouble(container);
    rendition.getRange.mockReturnValue(range);
    const result = await engine.getRangeRect(cfi);
    expect(result?.toJSON()).toMatchObject({ x: 120, y: 230, width: 120, height: 24 });
    container.remove();
  });
});

it("reflows when the scroll viewport changes without resizing the outer pane", () => {
  const container = document.createElement("div");
  const viewport = document.createElement("div");
  container.append(viewport);
  let availableWidth = 583;
  Object.defineProperties(container, { clientWidth: { value: 600 }, clientHeight: { value: 800 } });
  Object.defineProperties(viewport, { clientWidth: { get: () => availableWidth }, clientHeight: { value: 800 } });
  let frame: FrameRequestCallback = () => {};
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frame = callback; return 1; });
  const { engine, rendition } = mountedDouble(container);
  Object.assign(engine, { viewport });
  engine.resize();
  frame(0);
  expect(rendition.resize).toHaveBeenLastCalledWith();
  engine.resize();
  frame(1);
  expect(rendition.resize).toHaveBeenCalledTimes(1);
  availableWidth = 580;
  engine.resize();
  frame(2);
  expect(rendition.resize).toHaveBeenCalledTimes(2);
  // The engine never passes the 600px outer width or shrinks the scroll container to its own client width.
  expect(rendition.resize.mock.calls).toEqual([[], []]);
});

it("rejects fixed-layout EPUBs with an actionable explanation", async () => {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file("package.opf", `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">engine-test</dc:identifier><dc:title>Test</dc:title><dc:language>en</dc:language><meta property="rendition:layout">pre-paginated</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`);
  zip.file("chapter.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Test</title></head><body><p>Test</p></body></html>`);
  const engine = new EpubEngine(document.createElement("div"));
  await expect(engine.mount(await zip.generateAsync({ type: "arraybuffer" }))).rejects.toThrow("固定版式");
});

it("rejects a missing navigation resource without hanging and permits a healthy retry", async () => {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const packaging = (navigation: boolean) => `<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">retry-test</dc:identifier><dc:title>Retry</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>${navigation ? '<item id="ncx" href="missing.ncx" media-type="application/x-dtbncx+xml"/>' : ""}</manifest><spine${navigation ? ' toc="ncx"' : ""}><itemref idref="chapter"/></spine></package>`;
  zip.file("package.opf", packaging(true));
  zip.file("chapter.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Retry</title></head><body><p>Readable after retry.</p></body></html>`);
  const rendition = { on: vi.fn(), off: vi.fn(), themes: { default: vi.fn() }, display: vi.fn().mockResolvedValue(undefined), resize: vi.fn() };
  const render = vi.spyOn(Book.prototype, "renderTo").mockReturnValue(rendition as unknown as Rendition);
  const container = document.createElement("div");
  container.createDiv = (options) => {
    const child = document.createElement("div");
    if (typeof options === "object" && typeof options.cls === "string") child.className = options.cls;
    container.append(child);
    return child;
  };
  const engine = new EpubEngine(container);
  await expect(engine.mount(await zip.generateAsync({ type: "arraybuffer" }))).rejects.toThrow("missing.ncx");
  expect(container.childElementCount).toBe(0);
  expect(render).not.toHaveBeenCalled();
  zip.file("package.opf", packaging(false));
  await engine.mount(await zip.generateAsync({ type: "arraybuffer" }));
  expect(render).toHaveBeenCalledTimes(1);
  expect(rendition.display).toHaveBeenCalledTimes(1);
  expect(engine.getToc()).toHaveLength(1);
  engine.destroy();
}, 1000);
