import { describe, expect, it } from "vitest";
import { EpubCFI } from "epubjs";
import { compactRange, parseLegacyExcerpts } from "../src/migrate";

// Structure and three CFI pairs come from the user's export; prose is synthetic.
const book = "书籍/示例.epub";
function block(start = "/6/6!/4/4[C01-P001]/1:0", end = "/6/6!/4/4[C01-P001]/1:75", options: { path?: string; color?: string; body?: string; chapter?: string } = {}) {
  return `> [!ob-epub|${options.color ?? "yellow"}] [[${options.path ?? book}#cfi=${start}&end=${end}|${options.chapter ?? "第一章"}]]\n${options.body ?? "> 一段合成测试摘录。"}`;
}

describe("legacy excerpt import preview", () => {
  it("exports compact range reconstruction for existing source links", () => {
    expect(compactRange("/6/6!/4/4[C01-P001]/1:0", "/6/6!/4/4[C01-P001]/1:75")).toBe("epubcfi(/6/6!/4/4[C01-P001],/1:0,/1:75)");
    expect(() => compactRange("invalid", "also-invalid")).toThrow("简单字符位置");
  });

  it("reconstructs the three observed range shapes with exact EPUB.js endpoints", () => {
    const positions = [
      ["/6/6!/4/4[C01-P001]/1:0", "/6/6!/4/4[C01-P001]/1:75", "epubcfi(/6/6!/4/4[C01-P001],/1:0,/1:75)"],
      ["/6/6!/4/8[C01-P003]/1:0", "/6/6!/4/8[C01-P003]/1:101", "epubcfi(/6/6!/4/8[C01-P003],/1:0,/1:101)"],
      ["/6/6!/4/16[C01-P007]/1:0", "/6/6!/4/16[C01-P007]/5:81", "epubcfi(/6/6!/4/16[C01-P007],/1:0,/5:81)"],
    ];
    const markdown = `---\nepub-source: ${book}\n---\n\n# 摘录\n\n` + positions.map(([start, end], i) => block(start, end, { color: i === 1 ? "blue" : "yellow" })).join("\n\n---\n\n");
    const result = parseLegacyExcerpts(markdown, book);
    expect(result.warnings).toEqual([]);
    expect(result.annotations.map(item => item.cfiRange)).toEqual(positions.map(item => item[2]));
    expect(result.annotations.map(item => item.color)).toEqual(["yellow", "blue", "yellow"]);
    for (let i = 0; i < result.annotations.length; i++) {
      const start = new EpubCFI(result.annotations[i].cfiRange);
      const end = new EpubCFI(result.annotations[i].cfiRange);
      start.collapse(true); end.collapse(false);
      expect(start.toString()).toBe(`epubcfi(${positions[i][0]})`);
      expect(end.toString()).toBe(`epubcfi(${positions[i][1]})`);
    }
  });

  it("preserves multiline quote, chapter, and color", () => {
    const result = parseLegacyExcerpts(block(undefined, undefined, { body: "> 引文第一行\n>\n> 引文第二行", chapter: "章节 & 空格", color: "purple" }), book);
    expect(result.warnings).toEqual([]);
    expect(result.annotations[0]).toMatchObject({ quote: "引文第一行\n\n引文第二行", chapter: "章节 & 空格", color: "purple" });
  });

  it("reports unverified thought conventions rather than silently reclassifying prose", () => {
    const result = parseLegacyExcerpts(block(undefined, undefined, { body: "> 引文\n>\n> **想法**\n> 我的想法" }), book);
    expect(result.annotations).toEqual([]);
    expect(result.warnings[0]).toContain("未经验证的想法");
  });

  it("decodes escaped book and CFI values and accepts wrapped points", () => {
    const start = encodeURIComponent("epubcfi(/6/6!/4/4[C01-P001]/1:0)");
    const end = encodeURIComponent("epubcfi(/6/6!/4/4[C01-P001]/1:75)");
    const result = parseLegacyExcerpts(block(start, end, { path: encodeURIComponent(book) }), book);
    expect(result.warnings).toEqual([]);
    expect(result.annotations).toHaveLength(1);
  });

  it("requires both the frontmatter source and each link to match the selected book", () => {
    const document = `---\nepub-source: other.epub\n---\n${block()}`;
    expect(parseLegacyExcerpts(document, book)).toMatchObject({ annotations: [], warnings: [expect.stringContaining("epub-source")] });
    const result = parseLegacyExcerpts(block(undefined, undefined, { path: "other.epub" }) + "\n\n" + block(), book);
    expect(result.annotations).toHaveLength(1);
    expect(result.warnings[0]).toContain("路径与所选书籍不匹配");
  });

  it("deduplicates deterministic canonical CFIs without overwriting conflicting content", () => {
    const result = parseLegacyExcerpts([block(), block(), block(undefined, undefined, { body: "> 不同内容", color: "red" })].join("\n\n"), book);
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].quote).toBe("一段合成测试摘录。");
    expect(result.warnings).toEqual([expect.stringContaining("重复 CFI"), expect.stringContaining("内容不一致")]);
  });

  it.each([
    ["/6/6!/4/4/1:5", "/6/6!/4/4/1:3", "顺序颠倒"],
    ["/6/6!/4/4/1:5", "/6/6!/4/4/1:5", "顺序颠倒"],
    ["/6/6!/4/4/1:0", "/6/8!/4/4/1:5", "跨章节"],
    ["/6/6!/4/4/1:0[before,after]", "/6/6!/4/4/1:5", "简单字符位置"],
    ["/6/6!/4/4/1:-1", "/6/6!/4/4/1:5", "简单字符位置"],
  ])("reports unsupported or invalid CFI instead of inventing a range", (start, end, message) => {
    const result = parseLegacyExcerpts(block(start, end), book);
    expect(result.annotations).toEqual([]);
    expect(result.warnings[0]).toContain(message);
  });

  it("reports missing end positions, empty quotes, and unknown colors", () => {
    const bad = [block().replace(/&end=[^|]+/, ""), block(undefined, undefined, { body: "> " }), block(undefined, undefined, { color: "orange" }), "> [!ob-epub\n> 截断的标题"].join("\n\n");
    const result = parseLegacyExcerpts(bad, book);
    expect(result.annotations).toEqual([]);
    expect(result.warnings).toHaveLength(4);
  });

  it("does not silently treat unquoted attached prose as a quote or thought", () => {
    const result = parseLegacyExcerpts(block() + "\n\n原笔记中额外写下的内容", book);
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].thought).toBeUndefined();
    expect(result.warnings[0]).toContain("未引用文本");
  });

  it("handles CRLF and never treats unrelated callouts or headings as excerpts", () => {
    const result = parseLegacyExcerpts("# 章节\r\n> [!note]\r\n> 普通笔记\r\n\r\n" + block().replace(/\n/g, "\r\n"), book);
    expect(result.annotations).toHaveLength(1);
    expect(result.warnings).toEqual([]);
    expect(parseLegacyExcerpts("# 空笔记", book)).toEqual({ annotations: [], warnings: [] });
  });

  it("rejects unsafe target paths before parsing", () => {
    expect(() => parseLegacyExcerpts(block(), "../book.epub")).toThrow("路径无效");
    expect(() => parseLegacyExcerpts(block(), "book.pdf")).toThrow("EPUB");
  });
});
