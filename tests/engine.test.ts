// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { Window } from "happy-dom";
import { Book, type Rendition } from "epubjs";
import { EpubEngine, highlightColor, sanitizeBookDocument } from "../src/engine";

const cfi = "epubcfi(/6/2[chapter]!/4/2/1:0)";
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
  Object.assign(engine, { rendition, book: { spine: { get: () => ({ href: "chapter.xhtml" }) } } });
  return { engine, rendition, callbacks };
}

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
