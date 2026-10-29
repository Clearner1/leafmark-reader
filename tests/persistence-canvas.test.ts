import { describe, expect, it, vi } from "vitest";
import type { App, Vault, WorkspaceLeaf } from "obsidian";
import { emptyBook, parseBookState } from "../src/model";
import type { Annotation, AnnotationInput } from "../src/model";
import { LeafmarkStore } from "../src/store";
import { annotationNodeId, CanvasService, parseCanvas, sourceLink, upsertAnnotation } from "../src/canvas";

const bookPath = "书籍/长篇阅读.epub";
const canvasPath = "读书笔记.canvas";
const input: AnnotationInput = { cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:8)", quote: "人能够认识自己。", chapter: "第一章", color: "yellow" };
const annotation: Annotation = { ...input, id: "a-123", bookPath, createdAt: "2026-10-29T00:00:00.000Z", updatedAt: "2026-10-29T00:00:00.000Z" };
const emptyCanvas = () => ({ nodes: [], edges: [] });
const userNode = { id: "user", type: "text", x: -50, y: 40, width: 200, height: 180, text: "我的整理" };

class MemoryVault {
  data = new Map<string, string>([[bookPath, "binary fixture"], [canvasPath, JSON.stringify(emptyCanvas())]]);
  folders = new Set<string>();
  processCalls = 0;
  activeProcesses = 0;
  maxProcesses = 0;
  failProcessOnce = false;
  failBackup = false;
  beforeProcess?: () => void;
  afterCreate?: (path: string) => void;
  getName() { return "我的书库 & Notes"; }
  getFileByPath(path: string) { return this.data.has(path) ? { path, extension: path.split(".").pop()! } : null; }
  getAbstractFileByPath(path: string) { return this.getFileByPath(path) ?? (this.folders.has(path) ? { path } : null); }
  async read(file: { path: string }) {
    if (!this.data.has(file.path)) throw new Error("missing");
    return this.data.get(file.path)!;
  }
  async create(path: string, text: string) {
    if (this.data.has(path) || this.folders.has(path)) throw new Error("exists");
    if (this.failBackup && path.endsWith("leafmark-backup.json")) throw new Error("disk full");
    this.data.set(path, text);
    this.afterCreate?.(path);
    return this.getFileByPath(path)!;
  }
  async process(file: { path: string }, update: (text: string) => string) {
    this.activeProcesses++;
    this.maxProcesses = Math.max(this.maxProcesses, this.activeProcesses);
    this.processCalls++;
    try {
      await Promise.resolve();
      this.beforeProcess?.();
      this.beforeProcess = undefined;
      if (this.failProcessOnce) { this.failProcessOnce = false; throw new Error("disk full"); }
      const result = update(await this.read(file));
      this.data.set(file.path, result);
      return result;
    } finally { this.activeProcesses--; }
  }
  asVault() { return this as unknown as Vault; }
}

function mockApp(vault: MemoryVault, leaves: unknown[] = []) {
  const app = {
    vault: vault.asVault(),
    workspace: { getLeavesOfType: () => leaves, revealLeaf: vi.fn(async () => undefined) },
  } as unknown as App;
  return app;
}

function liveLeaf(vault: MemoryVault, initial = JSON.stringify(emptyCanvas())) {
  let text = initial;
  const view = {
    file: { path: canvasPath },
    getViewData: () => text,
    setViewData: vi.fn((next: string) => { text = next; }),
    save: vi.fn(async () => { vault.data.set(canvasPath, text); }),
    canvas: undefined as unknown,
  };
  return {
    view, getViewState: () => ({ state: { file: canvasPath } }), loadIfDeferred: vi.fn(async () => undefined),
  };
}

describe("visible sidecar persistence", () => {
  it("does not write merely by opening a book", async () => {
    const vault = new MemoryVault();
    const store = new LeafmarkStore(vault.asVault());
    expect(await store.loadBook(bookPath)).toEqual(emptyBook(bookPath));
    expect(vault.data.has(store.sidecarPath(bookPath))).toBe(false);
  });

  it("serializes separate store instances and retains every concurrent annotation", async () => {
    const vault = new MemoryVault();
    const stores = [new LeafmarkStore(vault.asVault()), new LeafmarkStore(vault.asVault())];
    const saved = await Promise.all(Array.from({ length: 20 }, (_, i) => stores[i % 2].addAnnotation(bookPath, { ...input, cfiRange: `epubcfi(/6/2!/4/2,/1:${i},/1:${i + 1})`, quote: `摘录 ${i}` })));
    await stores[0].savePosition(bookPath, "epubcfi(/6/4!/4/2:8)");
    await stores[1].bindCanvas(bookPath, canvasPath);
    const reopened = await new LeafmarkStore(vault.asVault()).loadBook(bookPath);
    expect(reopened.annotations.map(item => item.id)).toEqual(saved.map(item => item.id));
    expect(new Set(saved.map(item => item.id)).size).toBe(20);
    expect(reopened.position?.cfi).toBe("epubcfi(/6/4!/4/2:8)");
    expect(reopened.canvasPath).toBe(canvasPath);
    expect(vault.maxProcesses).toBe(1);
  });

  it.each(["{not json", JSON.stringify({ ...emptyBook(bookPath), version: 99 }), JSON.stringify({ ...emptyBook(bookPath), annotations: [annotation, annotation] })])("never overwrites corrupt or unsupported data", async broken => {
    const vault = new MemoryVault();
    const store = new LeafmarkStore(vault.asVault());
    vault.data.set(store.sidecarPath(bookPath), broken);
    await expect(store.loadBook(bookPath)).rejects.toThrow("原文件已保留");
    await expect(store.addAnnotation(bookPath, input)).rejects.toThrow("原文件已保留");
    expect(vault.data.get(store.sidecarPath(bookPath))).toBe(broken);
  });

  it("reads current data inside process and preserves unknown fields", async () => {
    const vault = new MemoryVault();
    const store = new LeafmarkStore(vault.asVault());
    const sidecar = store.sidecarPath(bookPath);
    vault.data.set(sidecar, JSON.stringify(emptyBook(bookPath)));
    vault.beforeProcess = () => vault.data.set(sidecar, JSON.stringify({ ...emptyBook(bookPath), annotations: [annotation], custom: { keep: true } }));
    await store.addAnnotation(bookPath, { ...input, cfiRange: "epubcfi(/6/2!/4/4,/1:0,/1:8)" });
    const state = JSON.parse(vault.data.get(sidecar)!);
    expect(state.annotations).toHaveLength(2);
    expect(state.custom).toEqual({ keep: true });
  });

  it("keeps a failed write observable and allows a subsequent retry", async () => {
    const vault = new MemoryVault();
    const store = new LeafmarkStore(vault.asVault());
    vault.failProcessOnce = true;
    await expect(store.addAnnotation(bookPath, input)).rejects.toThrow("disk full");
    const saved = await store.addAnnotation(bookPath, input);
    expect((await store.loadBook(bookPath)).annotations.map(item => item.id)).toEqual([saved.id]);
  });

  it("supports clearing thoughts without replacing identity or source anchors", async () => {
    const vault = new MemoryVault();
    const store = new LeafmarkStore(vault.asVault());
    const saved = await store.addAnnotation(bookPath, { ...input, thought: "我的想法" });
    const updated = await store.updateAnnotation(bookPath, saved.id, { thought: "", color: "red" });
    expect(updated).toMatchObject({ id: saved.id, cfiRange: input.cfiRange, thought: "", color: "red", createdAt: saved.createdAt });
    await store.deleteAnnotation(bookPath, saved.id);
    expect((await store.loadBook(bookPath)).annotations).toEqual([]);
  });

  it("deduplicates concurrent same-CFI additions inside the serialized mutation", async () => {
    const vault = new MemoryVault();
    const stores = [new LeafmarkStore(vault.asVault()), new LeafmarkStore(vault.asVault())];
    const saved = await Promise.all(Array.from({ length: 20 }, (_, i) => stores[i % 2].addAnnotation(bookPath, { ...input, quote: `输入 ${i}` })));
    expect(new Set(saved.map(item => item.id)).size).toBe(1);
    const state = await stores[0].loadBook(bookPath);
    expect(state.annotations).toHaveLength(1);
    expect(state.annotations[0].quote).toBe("输入 0");
  });

  it("merges a new thought into the existing position without replacing its quote or color", async () => {
    const vault = new MemoryVault();
    const store = new LeafmarkStore(vault.asVault());
    const first = await store.addAnnotation(bookPath, input);
    const merged = await store.addAnnotation(bookPath, { ...input, quote: "替代文字", thought: "新想法", color: "red" });
    expect(merged).toMatchObject({ id: first.id, quote: input.quote, color: input.color, thought: "新想法" });
    const retry = await store.addAnnotation(bookPath, { ...input, thought: " 新想法 " });
    const empty = await store.addAnnotation(bookPath, { ...input, thought: "" });
    expect(retry.thought).toBe("新想法");
    expect(empty.thought).toBe("新想法");
    expect((await store.loadBook(bookPath)).annotations).toHaveLength(1);
  });

  it("rejects conflicting concurrent thoughts and preserves the losing caller input", async () => {
    const vault = new MemoryVault();
    const store = new LeafmarkStore(vault.asVault());
    const incoming = { ...input, thought: "另一份想法" };
    const outcomes = await Promise.allSettled([
      store.addAnnotation(bookPath, { ...input, thought: "第一份想法" }),
      new LeafmarkStore(vault.asVault()).addAnnotation(bookPath, incoming),
    ]);
    expect(outcomes[0].status).toBe("fulfilled");
    expect(outcomes[1]).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: expect.stringContaining("新想法尚未保存") }) });
    expect(incoming.thought).toBe("另一份想法");
    const saved = await store.loadBook(bookPath);
    expect(saved.annotations).toHaveLength(1);
    expect(saved.annotations[0].thought).toBe("第一份想法");
  });

  it("rejects missing files, paths outside the vault, and invalid data", async () => {
    const vault = new MemoryVault();
    const store = new LeafmarkStore(vault.asVault());
    await expect(store.loadBook("missing.epub")).rejects.toThrow("找不到");
    expect(() => store.bindCanvas(bookPath, "missing.canvas")).toThrow("找不到");
    expect(() => store.sidecarPath("../secret.epub")).toThrow("路径无效");
    expect(() => store.addAnnotation(bookPath, { ...input, quote: " " })).toThrow("格式无效");
    await expect(store.savePosition(bookPath, "not-a-cfi")).rejects.toThrow("位置无效");
    expect(() => parseBookState(JSON.stringify({ ...emptyBook(bookPath), bookPath: "other.epub" }), bookPath)).toThrow("原文件已保留");
  });
});

describe("Canvas merge and source links", () => {
  it("encodes the exact source CFI, annotation, vault, and book path", () => {
    const url = new URL(sourceLink(annotation, "我的书库 & Notes"));
    expect(url.protocol).toBe("obsidian:");
    expect(url.hostname).toBe("leafmark");
    expect(url.searchParams.get("book")).toBe(bookPath);
    expect(url.searchParams.get("vault")).toBe("我的书库 & Notes");
    expect(url.searchParams.get("annotation")).toBe(annotation.id);
    expect(url.searchParams.get("cfi")).toBe(annotation.cfiRange);
  });

  it("upserts idempotently, preserves geometry, other nodes, edges, and custom data", () => {
    const original = parseCanvas(JSON.stringify({ nodes: [userNode], edges: [{ id: "e", fromNode: "user", toNode: "user" }], custom: { keep: true } }));
    const once = upsertAnnotation(original, annotation, "Books");
    const card = once.nodes[1];
    card.x = 900;
    card.width = 600;
    card.extra = { user: true };
    const twice = upsertAnnotation(once, { ...annotation, thought: "新的想法" }, "Books");
    expect(twice.nodes).toHaveLength(2);
    expect(twice.nodes[0]).toEqual(userNode);
    expect(twice.nodes[1]).toMatchObject({ x: 900, width: 600, extra: { user: true } });
    expect(twice.nodes[1].text).toContain("新的想法");
    expect(twice.edges).toEqual(original.edges);
    expect(twice.custom).toEqual({ keep: true });
    expect(original.nodes).toHaveLength(1);
  });

  it("retains appended user prose while refreshing untouched generated text", () => {
    const data = upsertAnnotation(emptyCanvas(), annotation, "Books");
    data.nodes[0].text = "我写的前言\n\n" + data.nodes[0].text + "\n\n我写的结尾";
    const result = upsertAnnotation(data, { ...annotation, thought: "补充想法" }, "Books");
    expect(result.nodes[0].text).toContain("补充想法");
    expect(result.nodes[0].text).toMatch(/^我写的前言/);
    expect(result.nodes[0].text).toMatch(/我写的结尾$/);
  });

  it("never overwrites edited generated text or manually selected colors", () => {
    let data = upsertAnnotation(emptyCanvas(), annotation, "Books");
    data.nodes[0].text = data.nodes[0].text!.replace("人能够认识自己。", "我手动改过的引文");
    data.nodes[0].color = "#123456";
    const text = data.nodes[0].text;
    data = upsertAnnotation(data, { ...annotation, thought: "新想法", color: "red" }, "Books");
    data = upsertAnnotation(data, { ...annotation, thought: "再更新", color: "blue" }, "Books");
    expect(data.nodes[0].text).toBe(text);
    expect(data.nodes[0].color).toBe("#123456");
  });

  it("keeps stable association even if Canvas removes custom metadata", () => {
    const data = upsertAnnotation(emptyCanvas(), annotation, "Books");
    delete data.nodes[0].leafmark;
    const result = upsertAnnotation(data, { ...annotation, thought: "新的想法" }, "Books");
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe(annotationNodeId(annotation));
    expect(result.nodes[0].text).toContain("新的想法");
  });

  it("rejects malformed Canvas and conflicting node types", () => {
    expect(() => parseCanvas('{"nodes":[{"id":"broken"}]}')).toThrow("原文件已保留");
    expect(() => parseCanvas('{"nodes":null,"edges":[]}')).toThrow("原文件已保留");
    expect(() => parseCanvas('{"nodes":[],"edges":null}')).toThrow("原文件已保留");
    const data = { nodes: [{ ...userNode, id: annotationNodeId(annotation), type: "file", file: "x.md" }], edges: [] };
    expect(() => upsertAnnotation(data, annotation, "Books")).toThrow("其他节点");
  });
});

describe("Canvas write safety", () => {
  it("backs up before a closed Canvas write and atomically merges newer content", async () => {
    const vault = new MemoryVault();
    const before = vault.data.get(canvasPath)!;
    vault.beforeProcess = () => vault.data.set(canvasPath, JSON.stringify({ nodes: [userNode], edges: [], untouched: true }));
    const service = new CanvasService(mockApp(vault));
    await service.syncAnnotation(annotation, canvasPath);
    await service.syncAnnotation(annotation, canvasPath);
    const result = JSON.parse(vault.data.get(canvasPath)!);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]).toEqual(userNode);
    expect(result.untouched).toBe(true);
    expect(vault.data.get(`${canvasPath}.leafmark-backup.json`)).toBe(before);
    expect(vault.processCalls).toBe(2);
  });

  it("does not change a Canvas when backup creation fails", async () => {
    const vault = new MemoryVault();
    vault.failBackup = true;
    const before = vault.data.get(canvasPath);
    await expect(new CanvasService(mockApp(vault)).syncAnnotation(annotation, canvasPath)).rejects.toThrow("无法保存画布备份");
    expect(vault.data.get(canvasPath)).toBe(before);
    expect(vault.processCalls).toBe(0);
  });

  it("never replaces malformed Canvas data with an empty document", async () => {
    const vault = new MemoryVault();
    vault.data.set(canvasPath, "broken");
    await expect(new CanvasService(mockApp(vault)).syncAnnotation(annotation, canvasPath)).rejects.toThrow("原文件已保留");
    expect(vault.data.get(canvasPath)).toBe("broken");
    expect(vault.data.has(`${canvasPath}.leafmark-backup.json`)).toBe(false);
  });

  it("uses live view contents and re-reads edits made during asynchronous backup", async () => {
    const vault = new MemoryVault();
    const live = liveLeaf(vault, JSON.stringify({ nodes: [userNode], edges: [] }));
    vault.afterCreate = () => {
      live.view.setViewData(JSON.stringify({ nodes: [{ ...userNode, text: "备份期间又输入的内容" }], edges: [], latest: true }));
    };
    await new CanvasService(mockApp(vault, [live])).syncAnnotation(annotation, canvasPath);
    const result = JSON.parse(vault.data.get(canvasPath)!);
    expect(result.nodes[0].text).toBe("备份期间又输入的内容");
    expect(result.latest).toBe(true);
    expect(result.nodes).toHaveLength(2);
    expect(live.view.save).toHaveBeenCalledOnce();
    expect(vault.processCalls).toBe(0);
    expect(JSON.parse(vault.data.get(`${canvasPath}.leafmark-backup.json`)!).nodes[0]).toEqual(userNode);
  });

  it("fails closed for unsupported open views and duplicate open panes", async () => {
    const vault = new MemoryVault();
    const live = liveLeaf(vault);
    const unsupported = { ...live, view: { file: { path: canvasPath } } };
    const before = vault.data.get(canvasPath);
    await expect(new CanvasService(mockApp(vault, [unsupported])).syncAnnotation(annotation, canvasPath)).rejects.toThrow("接口");
    await expect(new CanvasService(mockApp(vault, [live, liveLeaf(vault)])).syncAnnotation(annotation, canvasPath)).rejects.toThrow("多个窗格");
    expect(vault.data.get(canvasPath)).toBe(before);
    expect(vault.data.has(`${canvasPath}.leafmark-backup.json`)).toBe(false);
  });

  it("rejects a closed-file write if a live pane appears before process", async () => {
    const vault = new MemoryVault();
    const leaves: unknown[] = [];
    const before = vault.data.get(canvasPath);
    vault.beforeProcess = () => leaves.push(liveLeaf(vault));
    await expect(new CanvasService(mockApp(vault, leaves)).syncAnnotation(annotation, canvasPath)).rejects.toThrow("刚刚被打开");
    expect(vault.data.get(canvasPath)).toBe(before);
  });

  it("reports a real save failure after updating the open view", async () => {
    const vault = new MemoryVault();
    const live = liveLeaf(vault);
    live.view.save.mockRejectedValueOnce(new Error("write denied"));
    await expect(new CanvasService(mockApp(vault, [live])).syncAnnotation(annotation, canvasPath)).rejects.toThrow("write denied");
    expect(JSON.parse(vault.data.get(canvasPath)!).nodes).toEqual([]);
  });

  it("focuses the stable card node and reports unsupported focus explicitly", async () => {
    const vault = new MemoryVault();
    const live = liveLeaf(vault, JSON.stringify(upsertAnnotation(emptyCanvas(), annotation, "Books")));
    const node = { card: true };
    const selectOnly = vi.fn();
    const zoomToSelection = vi.fn();
    live.view.canvas = { nodes: new Map([[annotationNodeId(annotation), node]]), selectOnly, zoomToSelection };
    const service = new CanvasService(mockApp(vault, [live]));
    await service.focusAnnotation(annotation, canvasPath);
    expect(selectOnly).toHaveBeenCalledWith(node);
    expect(zoomToSelection).toHaveBeenCalledOnce();
    live.view.canvas = undefined;
    await expect(service.focusAnnotation(annotation, canvasPath)).rejects.toThrow("不支持定位");
  });
});

describe("explicit legacy Canvas adoption", () => {
  const legacyNode = () => ({
    ...userNode, id: "original-card", color: "#123456", text: "旧摘录与我手工补充的内容",
    epubCanvas: { book: bookPath, cfi: annotation.cfiRange, generated: "最初生成的内容" },
    styleAttributes: { custom: true },
  });

  it("associates only metadata and keeps original IDs, text, geometry, color, edges, and custom fields", async () => {
    const vault = new MemoryVault();
    const node = legacyNode();
    const original = { nodes: [node, { ...userNode, id: "other" }], edges: [{ id: "edge", fromNode: node.id, toNode: "other", label: "原连线" }], metadata: { keep: true } };
    const before = JSON.stringify(original);
    vault.data.set(canvasPath, before);
    const service = new CanvasService(mockApp(vault));
    expect(await service.adoptLegacyAnnotation(annotation, canvasPath)).toBe(true);
    const adopted = JSON.parse(vault.data.get(canvasPath)!);
    expect(adopted).toEqual({ ...original, nodes: [{ ...node, leafmark: { annotationId: annotation.id, bookPath, cfiRange: annotation.cfiRange } }, original.nodes[1]] });
    expect(vault.data.get(`${canvasPath}.leafmark-backup.json`)).toBe(before);
    const calls = vault.processCalls;
    expect(await service.adoptLegacyAnnotation(annotation, canvasPath)).toBe(true);
    expect(vault.processCalls).toBe(calls);
    expect(await service.syncAnnotation({ ...annotation, thought: "新想法", color: "red" }, canvasPath)).toBe(node.id);
    const synced = JSON.parse(vault.data.get(canvasPath)!);
    expect(synced.nodes).toHaveLength(original.nodes.length);
    const { leafmark: association, ...preserved } = synced.nodes[0];
    expect(preserved).toEqual(node);
    expect(association.annotationId).toBe(annotation.id);
    expect(synced.edges).toEqual(original.edges);
  });

  it("returns false without writes when book or CFI does not match exactly", async () => {
    const vault = new MemoryVault();
    const node = legacyNode();
    node.epubCanvas.cfi = "epubcfi(/6/6!/4/4,/1:0,/1:9)";
    const another = { ...legacyNode(), id: "another", epubCanvas: { ...legacyNode().epubCanvas, book: "different.epub" } };
    const before = JSON.stringify({ nodes: [node, another], edges: [] });
    vault.data.set(canvasPath, before);
    expect(await new CanvasService(mockApp(vault)).adoptLegacyAnnotation(annotation, canvasPath)).toBe(false);
    expect(vault.data.get(canvasPath)).toBe(before);
    expect(vault.processCalls).toBe(0);
    expect(vault.data.has(`${canvasPath}.leafmark-backup.json`)).toBe(false);
  });

  it("rejects ambiguous old matches before creating even a backup", async () => {
    const vault = new MemoryVault();
    const before = JSON.stringify({ nodes: [legacyNode(), { ...legacyNode(), id: "duplicate" }], edges: [] });
    vault.data.set(canvasPath, before);
    await expect(new CanvasService(mockApp(vault)).adoptLegacyAnnotation(annotation, canvasPath)).rejects.toThrow("多张旧卡片");
    expect(vault.data.get(canvasPath)).toBe(before);
    expect(vault.data.has(`${canvasPath}.leafmark-backup.json`)).toBe(false);
  });

  it("rejects an existing different association or a competing new card", async () => {
    const vault = new MemoryVault();
    const occupied = { nodes: [{ ...legacyNode(), leafmark: { annotationId: "some-other-annotation", bookPath } }], edges: [] };
    vault.data.set(canvasPath, JSON.stringify(occupied));
    const service = new CanvasService(mockApp(vault));
    await expect(service.adoptLegacyAnnotation(annotation, canvasPath)).rejects.toThrow("不同的摘录关联");
    expect(JSON.parse(vault.data.get(canvasPath)!)).toEqual(occupied);
    const competing = upsertAnnotation({ nodes: [legacyNode()], edges: [] }, annotation, "Books");
    vault.data.set(canvasPath, JSON.stringify(competing));
    await expect(service.adoptLegacyAnnotation(annotation, canvasPath)).rejects.toThrow("已关联另一张卡片");
    expect(JSON.parse(vault.data.get(canvasPath)!)).toEqual(competing);
  });

  it("uses the same live-memory safety path for adoption", async () => {
    const vault = new MemoryVault();
    const live = liveLeaf(vault, JSON.stringify({ nodes: [legacyNode()], edges: [] }));
    vault.afterCreate = () => {
      const current = JSON.parse(live.view.getViewData());
      current.nodes[0].text = "关联期间新输入的文字";
      current.nodes[0].x = 876;
      live.view.setViewData(JSON.stringify(current));
    };
    expect(await new CanvasService(mockApp(vault, [live])).adoptLegacyAnnotation(annotation, canvasPath)).toBe(true);
    const saved = JSON.parse(vault.data.get(canvasPath)!);
    expect(saved.nodes[0]).toMatchObject({ id: "original-card", text: "关联期间新输入的文字", x: 876, leafmark: { annotationId: annotation.id } });
    expect(vault.processCalls).toBe(0);
    expect(live.view.save).toHaveBeenCalledOnce();
  });

  it("retries saving an association left only in memory after a failed save", async () => {
    const vault = new MemoryVault();
    const original = JSON.stringify({ nodes: [legacyNode()], edges: [] });
    vault.data.set(canvasPath, original);
    const live = liveLeaf(vault, original);
    live.view.save.mockRejectedValueOnce(new Error("disk full"));
    const service = new CanvasService(mockApp(vault, [live]));
    await expect(service.adoptLegacyAnnotation(annotation, canvasPath)).rejects.toThrow("disk full");
    expect(vault.data.get(canvasPath)).toBe(original);
    const edited = JSON.parse(live.view.getViewData());
    expect(edited.nodes[0].leafmark.annotationId).toBe(annotation.id);
    edited.nodes[0].text = "失败后继续编辑的内容";
    live.view.setViewData(JSON.stringify(edited));
    expect(await service.adoptLegacyAnnotation(annotation, canvasPath)).toBe(true);
    expect(live.view.save).toHaveBeenCalledTimes(2);
    const saved = JSON.parse(vault.data.get(canvasPath)!);
    expect(saved.nodes[0]).toMatchObject({ text: "失败后继续编辑的内容", leafmark: { annotationId: annotation.id } });
    expect(vault.data.get(`${canvasPath}.leafmark-backup.json`)).toBe(original);
  });

  it("does not report adoption success if the native save returns without persisting", async () => {
    const vault = new MemoryVault();
    const original = JSON.stringify({ nodes: [legacyNode()], edges: [] });
    vault.data.set(canvasPath, original);
    const live = liveLeaf(vault, original);
    live.view.save.mockImplementation(async () => undefined);
    const service = new CanvasService(mockApp(vault, [live]));
    await expect(service.adoptLegacyAnnotation(annotation, canvasPath)).rejects.toThrow("尚未写入画布文件");
    await expect(service.adoptLegacyAnnotation(annotation, canvasPath)).rejects.toThrow("尚未写入画布文件");
    expect(live.view.save).toHaveBeenCalledTimes(2);
    expect(vault.data.get(canvasPath)).toBe(original);
  });

  it("focuses the existing native card by its explicit association", async () => {
    const vault = new MemoryVault();
    const node = { ...legacyNode(), leafmark: { annotationId: annotation.id, bookPath, cfiRange: annotation.cfiRange } };
    const live = liveLeaf(vault, JSON.stringify({ nodes: [node], edges: [] }));
    const nativeNode = { id: node.id };
    const selectOnly = vi.fn();
    live.view.canvas = { nodes: new Map([[node.id, nativeNode]]), selectOnly, zoomToSelection: vi.fn() };
    await new CanvasService(mockApp(vault, [live])).focusAnnotation(annotation, canvasPath);
    expect(selectOnly).toHaveBeenCalledWith(nativeNode);
  });

  it("never auto-adopts and refuses multiple explicit associations", async () => {
    const original = { nodes: [legacyNode()], edges: [] };
    const synced = upsertAnnotation(original, annotation, "Books");
    expect(synced.nodes).toHaveLength(2);
    expect(synced.nodes[0]).toEqual(original.nodes[0]);
    synced.nodes[0].leafmark = { annotationId: annotation.id, bookPath };
    expect(() => upsertAnnotation(synced, annotation, "Books")).toThrow("多张画布卡片");
  });

  it("does not add a generated color to an adopted uncolored card", async () => {
    const node = { ...userNode, leafmark: { annotationId: annotation.id, bookPath, cfiRange: annotation.cfiRange } };
    const updated = upsertAnnotation({ nodes: [node], edges: [] }, annotation, "Books");
    expect(updated.nodes).toHaveLength(1);
    expect(updated.nodes[0].color).toBeUndefined();
    expect(updated.nodes[0].text).toBe(node.text);
  });
});
