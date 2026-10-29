// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { Window } from "happy-dom";
import { Book, type Rendition } from "epubjs";
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

function searchSection(index: number, href = `chapter${index}.xhtml`) {
  return { index, href, load: vi.fn().mockResolvedValue(undefined), find: vi.fn().mockReturnValue([{ cfi: `${cfi}-${index}`, excerpt: `Needle in chapter ${index}` }]), unload: vi.fn() };
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
      section.find.mockImplementation(query => { expect(query).toBe("Needle"); events.push(`find ${section.index}`); return [{ cfi: `${cfi}-${section.index}`, excerpt: `Needle in chapter ${section.index}` }]; });
      section.unload.mockImplementation(() => { events.push(`unload ${section.index}`); });
    }
    expect(await engine.search("  Needle  ")).toEqual([
      { cfi: `${cfi}-0`, excerpt: "Needle in chapter 0", chapter: "First chapter", sectionHref: "chapter0.xhtml", sectionIndex: 0 },
      { cfi: `${cfi}-1`, excerpt: "Needle in chapter 1", chapter: "Nested chapter", sectionHref: "chapter1.xhtml", sectionIndex: 1 },
      { cfi: `${cfi}-2`, excerpt: "Needle in chapter 2", chapter: "正文", sectionHref: "chapter2.xhtml", sectionIndex: 2 },
    ]);
    expect(events).toEqual(["load 0", "find 0", "unload 0", "load 1", "find 1", "unload 1", "load 2", "find 2", "unload 2"]);
    expect(book.load).toHaveBeenCalledTimes(3);
  });

  it("releases failed chapters and continues after loading, searching, or unloading errors", async () => {
    const sections = [searchSection(0), searchSection(1), searchSection(2), searchSection(3)];
    sections[0].load.mockRejectedValue(new Error("Missing chapter"));
    sections[1].find.mockImplementation(() => { throw new Error("Invalid chapter"); });
    sections[2].unload.mockImplementation(() => { throw new Error("Release failed"); });
    const { engine } = searchDouble(sections);
    expect((await engine.search("needle")).map(hit => hit.sectionIndex)).toEqual([2, 3]);
    expect(sections[0].find).not.toHaveBeenCalled();
    for (const section of sections) expect(section.unload).toHaveBeenCalledTimes(1);
  });

  it("does not load chapters for blank queries or a closed book", async () => {
    const section = searchSection(0);
    const { engine } = searchDouble([section]);
    expect(await engine.search(" \n\t ")).toEqual([]);
    engine.destroy();
    expect(await engine.search("needle")).toEqual([]);
    expect(section.load).not.toHaveBeenCalled();
    expect(await new EpubEngine(document.createElement("div")).search("needle")).toEqual([]);
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
    expect(await pending).toEqual([]);
    expect(sections[0].find).not.toHaveBeenCalled();
    expect(sections[0].unload).toHaveBeenCalledTimes(1);
    expect(sections[1].load).not.toHaveBeenCalled();
  });

  it("finds every occurrence across real archive chapters and unloads their detached documents", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file("META-INF/container.xml", `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
    zip.file("package.opf", `<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">search-test</dc:identifier><dc:title>Search</dc:title><dc:language>en</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`);
    zip.file("one.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>First</title></head><body><p>Needle, then another NEEDLE.</p></body></html>`);
    zip.file("two.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Second</title></head><body><p>A final needle.</p><script>needle</script></body></html>`);
    const rendition = { on: vi.fn(), off: vi.fn(), themes: { default: vi.fn() }, display: vi.fn().mockResolvedValue(undefined), resize: vi.fn() };
    vi.spyOn(Book.prototype, "renderTo").mockReturnValue(rendition as unknown as Rendition);
    const engine = new EpubEngine(document.createElement("div"));
    await engine.mount(await zip.generateAsync({ type: "arraybuffer" }));
    const hits = await engine.search("needle");
    expect(hits.map(hit => hit.sectionIndex)).toEqual([0, 0, 1]);
    expect(hits.map(hit => hit.chapter)).toEqual(["第 1 节", "第 1 节", "第 2 节"]);
    expect(new Set(hits.map(hit => hit.cfi)).size).toBe(3);
    const book = (engine as unknown as { book: Book }).book;
    book.spine.each((section: { document?: Document; contents?: Element }) => {
      expect(section.document).toBeUndefined();
      expect(section.contents).toBeUndefined();
    });
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
