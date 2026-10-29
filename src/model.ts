// Original Leafmark schema; no data or code is imported from another EPUB plugin.
export const ANNOTATION_COLORS = ["yellow", "red", "green", "blue", "purple"] as const;
export type AnnotationColor = typeof ANNOTATION_COLORS[number];

export interface AnnotationInput {
  cfiRange: string;
  quote: string;
  thought?: string;
  chapter: string;
  color: AnnotationColor;
}

export interface Annotation extends AnnotationInput {
  id: string;
  bookPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationPatch {
  thought?: string;
  color?: AnnotationColor;
}

export interface BookState {
  version: 1;
  bookPath: string;
  annotations: Annotation[];
  position: { cfi: string; updatedAt: string } | null;
  canvasPath: string | null;
}

export function vaultPath(value: string): string {
  if (typeof value !== "string" || !value || /[\\\u0000-\u001f]/.test(value)
      || value.startsWith("/") || value.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("文件路径无效，请选择库内文件。");
  }
  return value;
}

export function emptyBook(bookPath: string): BookState {
  return { version: 1, bookPath: vaultPath(bookPath), annotations: [], position: null, canvasPath: null };
}

export function isCfi(value: unknown): value is string {
  return typeof value === "string" && /^epubcfi\(.+\)$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validateAnnotation(value: unknown, bookPath: string): asserts value is Annotation {
  if (!isRecord(value) || typeof value.id !== "string" || !/^[\w-]+$/.test(value.id)
      || value.bookPath !== bookPath || !isCfi(value.cfiRange)
      || typeof value.quote !== "string" || !value.quote.trim()
      || typeof value.chapter !== "string"
      || (value.thought !== undefined && typeof value.thought !== "string")
      || !ANNOTATION_COLORS.includes(value.color as AnnotationColor)
      || !timestamp(value.createdAt) || !timestamp(value.updatedAt)) {
    throw new Error("摘录数据不完整或格式无效。");
  }
}

export function parseBookState(text: string, bookPath: string): BookState {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || value.version !== 1 || value.bookPath !== vaultPath(bookPath)
        || !Array.isArray(value.annotations)
        || !(value.canvasPath === null || typeof value.canvasPath === "string")
        || !(value.position === null || (isRecord(value.position)
          && isCfi(value.position.cfi) && timestamp(value.position.updatedAt)))) {
      throw new Error("数据结构或版本不受支持");
    }
    if (value.canvasPath !== null) vaultPath(value.canvasPath as string);
    const ids = new Set<string>();
    for (const annotation of value.annotations) {
      validateAnnotation(annotation, bookPath);
      if (ids.has(annotation.id)) throw new Error("重复的摘录标识");
      ids.add(annotation.id);
    }
    return value as unknown as BookState;
  } catch (error) {
    throw new Error(`无法读取 ${bookPath}.leafmark.json；原文件已保留，请检查数据。${error instanceof Error ? error.message : ""}`);
  }
}
