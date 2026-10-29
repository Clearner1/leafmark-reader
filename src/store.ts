import type { TFile, Vault } from "obsidian";
import { emptyBook, isCfi, parseBookState, validateAnnotation, vaultPath } from "./model";
import type { Annotation, AnnotationInput, AnnotationPatch, BookState } from "./model";

// Persistence contract: https://docs.obsidian.md/Plugins/Vault (Vault.process).
const queues = new WeakMap<Vault, Map<string, Promise<unknown>>>();

// Share the queue between views and service instances; one rejected write must not block the next.
export function serializeVaultWrite<T>(vault: Vault, path: string, operation: () => Promise<T>): Promise<T> {
  let pending = queues.get(vault);
  if (!pending) { pending = new Map(); queues.set(vault, pending); }
  const next = (pending.get(path) ?? Promise.resolve()).catch(() => undefined).then(operation);
  pending.set(path, next);
  void next.finally(() => { if (pending?.get(path) === next) pending.delete(path); }).catch(() => undefined);
  return next;
}

export function requireFile(vault: Vault, path: string, extension?: string): TFile {
  const file = vault.getFileByPath(vaultPath(path));
  if (!file || (extension && file.extension.toLowerCase() !== extension)) {
    throw new Error(`找不到${extension === "canvas" ? "画布" : "文件"}：${path}。请重新选择文件。`);
  }
  return file;
}

export class LeafmarkStore {
  constructor(private readonly vault: Vault) {}

  sidecarPath(bookPath: string): string { return `${vaultPath(bookPath)}.leafmark.json`; }

  async loadBook(bookPath: string): Promise<BookState> {
    const path = this.sidecarPath(bookPath);
    return serializeVaultWrite(this.vault, path, async () => {
      requireFile(this.vault, bookPath, "epub");
      const file = this.vault.getFileByPath(path);
      if (file) return parseBookState(await this.vault.read(file), bookPath);
      if (this.vault.getAbstractFileByPath(path)) throw new Error(`数据路径被文件夹占用：${path}`);
      return emptyBook(bookPath);
    });
  }

  private change<T>(bookPath: string, mutate: (state: BookState) => T): Promise<T> {
    const path = this.sidecarPath(bookPath);
    return serializeVaultWrite(this.vault, path, async () => {
      requireFile(this.vault, bookPath, "epub");
      let file = this.vault.getFileByPath(path);
      if (!file) {
        if (this.vault.getAbstractFileByPath(path)) throw new Error(`数据路径被文件夹占用：${path}`);
        try { file = await this.vault.create(path, JSON.stringify(emptyBook(bookPath), null, 2) + "\n"); }
        catch (error) {
          // A second plugin instance or sync may have created it while create was pending.
          file = this.vault.getFileByPath(path);
          if (!file) throw error;
        }
      }
      let result!: T;
      await this.vault.process(file, text => {
        const state = parseBookState(text, bookPath);
        result = mutate(state);
        const updated = JSON.stringify(state, null, 2) + "\n";
        parseBookState(updated, bookPath);
        return updated;
      });
      return result;
    });
  }

  addAnnotation(bookPath: string, input: AnnotationInput): Promise<Annotation> {
    const now = new Date().toISOString();
    const annotation: Annotation = { ...input, id: crypto.randomUUID(), bookPath, createdAt: now, updatedAt: now };
    validateAnnotation(annotation, bookPath);
    return this.change(bookPath, state => {
      const existing = state.annotations.find(item => item.cfiRange === annotation.cfiRange);
      if (existing) {
        const savedThought = existing.thought?.trim();
        const newThought = annotation.thought?.trim();
        if (savedThought && newThought && savedThought !== newThought) {
          throw new Error("此处已有不同的想法。您的新想法尚未保存，请保留输入并检查已有摘录。");
        }
        if (!savedThought && newThought) {
          existing.thought = annotation.thought;
          existing.updatedAt = annotation.updatedAt;
        }
        return existing;
      }
      state.annotations.push(annotation);
      return annotation;
    });
  }

  updateAnnotation(bookPath: string, id: string, patch: AnnotationPatch): Promise<Annotation> {
    return this.change(bookPath, state => {
      const annotation = state.annotations.find(item => item.id === id);
      if (!annotation) throw new Error("找不到这条摘录，数据可能已在另一窗口更新。");
      if (patch.thought !== undefined) annotation.thought = patch.thought;
      if (patch.color !== undefined) annotation.color = patch.color;
      annotation.updatedAt = new Date().toISOString();
      return annotation;
    });
  }

  deleteAnnotation(bookPath: string, id: string): Promise<void> {
    return this.change(bookPath, state => {
      if (!state.annotations.some(item => item.id === id)) throw new Error("找不到这条摘录。");
      state.annotations = state.annotations.filter(item => item.id !== id);
    });
  }

  savePosition(bookPath: string, cfi: string): Promise<void> {
    if (!isCfi(cfi)) return Promise.reject(new Error("阅读位置无效，未保存。"));
    return this.change(bookPath, state => { state.position = { cfi, updatedAt: new Date().toISOString() }; });
  }

  bindCanvas(bookPath: string, canvasPath: string | null): Promise<void> {
    if (canvasPath !== null) requireFile(this.vault, canvasPath, "canvas");
    return this.change(bookPath, state => { state.canvasPath = canvasPath; });
  }
}
