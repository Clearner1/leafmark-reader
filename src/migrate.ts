import { EpubCFI } from "epubjs";
import { ANNOTATION_COLORS, vaultPath } from "./model";
import type { AnnotationColor, AnnotationInput } from "./model";

export interface LegacyImportResult {
  annotations: AnnotationInput[];
  warnings: string[];
}

// Only the compact character positions observed in exported user data are accepted.
// EPUB.js validates/compares the points and round-trips the resulting standard CFI range.
export function compactRange(startValue: string, endValue: string): string {
  const unwrap = (value: string) => value.startsWith("epubcfi(") && value.endsWith(")") ? value.slice(8, -1) : value;
  const startBody = unwrap(startValue);
  const endBody = unwrap(endValue);
  const step = String.raw`\/(?:0|[1-9]\d*)(?:\[[A-Za-z0-9_.-]+\])?`;
  const supportedPoint = new RegExp(`^(?:${step})+!(?:${step})+:(?:0|[1-9]\\d*)$`);
  if (!supportedPoint.test(startBody) || !supportedPoint.test(endBody)) {
    throw new Error("CFI 不是支持的简单字符位置，未猜测转换");
  }
  const startText = `epubcfi(${startBody})`;
  const endText = `epubcfi(${endBody})`;
  const start = new EpubCFI(startText);
  const end = new EpubCFI(endText);
  if (start.range || end.range || start.toString() !== startText || end.toString() !== endText
      || !Number.isFinite(start.spinePos) || start.spinePos < 0 || start.compare(start, end) >= 0) {
    throw new Error("CFI 起止位置无效或顺序颠倒");
  }
  const [base, startPath] = startBody.split("!");
  const [endBase, endPath] = endBody.split("!");
  if (base !== endBase) throw new Error("跨章节 CFI 范围暂不支持，请单独检查");
  const left = startPath.split("/");
  const right = endPath.split("/");
  let shared = 0;
  while (shared < Math.min(left.length, right.length) - 1 && left[shared] === right[shared]) shared++;
  if (shared < 2) throw new Error("CFI 缺少共同内容路径");
  // The standard range is shared path + two relative paths; no old plugin parser is used.
  const candidate = `epubcfi(${base}!${left.slice(0, shared).join("/")},/${left.slice(shared).join("/")},/${right.slice(shared).join("/")})`;
  const range = new EpubCFI(candidate);
  const collapsedStart = new EpubCFI(range.toString());
  const collapsedEnd = new EpubCFI(range.toString());
  collapsedStart.collapse(true);
  collapsedEnd.collapse(false);
  if (!range.range || collapsedStart.toString() !== startText || collapsedEnd.toString() !== endText) {
    throw new Error("CFI 范围转换校验失败");
  }
  return range.toString();
}

function parseHeader(header: string, expectedBook: string): Omit<AnnotationInput, "quote"> {
  const match = /^>\s*\[!ob-epub\|([^\]]+)\]\s*\[\[(.+)\]\]\s*$/.exec(header);
  if (!match) throw new Error("摘录标题或原文链接格式不完整");
  const color = match[1].toLowerCase();
  if (!ANNOTATION_COLORS.includes(color as AnnotationColor)) throw new Error(`不支持的高亮颜色：${color}`);
  const aliasIndex = match[2].lastIndexOf("|");
  if (aliasIndex < 0) throw new Error("原文链接缺少章节名称");
  const target = match[2].slice(0, aliasIndex);
  const chapter = match[2].slice(aliasIndex + 1);
  const fragment = target.indexOf("#cfi=");
  if (fragment < 0) throw new Error("原文链接缺少 CFI");
  const source = decodeURIComponent(target.slice(0, fragment));
  if (vaultPath(source) !== expectedBook) throw new Error("原文路径与所选书籍不匹配");
  const params = new URLSearchParams(target.slice(fragment + 1));
  if (params.getAll("cfi").length !== 1 || params.getAll("end").length !== 1
      || [...params.keys()].some(key => key !== "cfi" && key !== "end")) {
    throw new Error("CFI 起止参数缺失、重复或包含未知字段");
  }
  return { cfiRange: compactRange(params.get("cfi")!, params.get("end")!), chapter, color: color as AnnotationColor };
}

/** Pure, opt-in conversion of exported Markdown. It performs no reads, writes, or deletion. */
export function parseLegacyExcerpts(markdown: string, bookPath: string): LegacyImportResult {
  vaultPath(bookPath);
  if (!bookPath.toLowerCase().endsWith(".epub")) throw new Error("请选择 EPUB 书籍路径。");
  const annotations: AnnotationInput[] = [];
  const warnings: string[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(lines.join("\n"));
  const sourceMatch = frontmatter && /^epub-source:\s*(.+)\s*$/m.exec(frontmatter[1]);
  if (sourceMatch) {
    const source = sourceMatch[1].trim().replace(/^(["'])(.*)\1$/, "$2");
    if (source !== bookPath) return { annotations, warnings: ["笔记的 epub-source 与所选书籍不匹配，未导入任何摘录。"] };
  }
  const seen = new Map<string, AnnotationInput>();
  for (let index = 0; index < lines.length; index++) {
    if (!/^>\s*\[!ob-epub\b/.test(lines[index])) continue;
    const lineNumber = index + 1;
    const header = lines[index];
    const body: string[] = [];
    while (index + 1 < lines.length && /^>/.test(lines[index + 1]) && !/^>\s*\[!ob-epub\b/.test(lines[index + 1])) {
      body.push(lines[++index].replace(/^> ?/, ""));
    }
    try {
      const metadata = parseHeader(header, bookPath);
      if (body.some(line => /^\*\*想法[：:]?\*\*[：:]?\s*$/.test(line) || /^\[!/.test(line))) {
        throw new Error("此块含未经验证的想法或嵌套标注格式，请保留原文并单独检查");
      }
      const quote = body.join("\n").trim();
      if (!quote) throw new Error("摘录正文为空");
      const item: AnnotationInput = { ...metadata, quote };
      const previous = seen.get(item.cfiRange);
      if (previous) {
        const same = previous.quote === item.quote && previous.thought === item.thought
          && previous.color === item.color && previous.chapter === item.chapter;
        warnings.push(`第 ${lineNumber} 行：${same ? "重复 CFI 已跳过" : "同一 CFI 的内容不一致，保留第一条，请人工检查"}。`);
      } else {
        seen.set(item.cfiRange, item);
        annotations.push(item);
      }
      let following = index + 1;
      while (following < lines.length && !lines[following].trim()) following++;
      if (following < lines.length && !/^(?:>|#|---\s*$|<!--)/.test(lines[following])) {
        warnings.push(`第 ${following + 1} 行：摘录后的未引用文本未自动归入想法，请检查原笔记。`);
      }
    } catch (error) {
      warnings.push(`第 ${lineNumber} 行：${error instanceof Error ? error.message : "无法解析摘录"}；此条未导入。`);
    }
  }
  return { annotations, warnings };
}
