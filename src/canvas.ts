import type { App, TextFileView, WorkspaceLeaf } from "obsidian";
import type { Annotation } from "./model";
import { validateAnnotation, vaultPath } from "./model";
import { requireFile, serializeVaultWrite } from "./store";

// Original implementation against https://jsoncanvas.org/spec/1.0/ and the public
// TextFileView contract in https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts.
export interface CanvasNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  [key: string]: unknown;
}

export interface CanvasDocument {
  nodes: CanvasNode[];
  edges: Record<string, unknown>[];
  [key: string]: unknown;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCanvas(text: string): CanvasDocument {
  try {
    const value: unknown = JSON.parse(text);
    if (!record(value)) throw new Error("画布内容必须是对象");
    const nodes = value.nodes === undefined ? [] : value.nodes;
    const edges = value.edges === undefined ? [] : value.edges;
    if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new Error("节点或连线不是数组");
    const ids = new Set<string>();
    for (const node of nodes) {
      if (!record(node) || typeof node.id !== "string" || !node.id || ids.has(node.id)
          || typeof node.type !== "string"
          || ![node.x, node.y, node.width, node.height].every(n => typeof n === "number" && Number.isFinite(n))
          || (node.width as number) <= 0 || (node.height as number) <= 0
          || (node.type === "text" && typeof node.text !== "string")
          || (node.type === "file" && typeof node.file !== "string")
          || (node.type === "link" && typeof node.url !== "string")) throw new Error("节点格式无效或标识重复");
      ids.add(node.id);
    }
    const edgeIds = new Set<string>();
    for (const edge of edges) {
      if (!record(edge) || typeof edge.id !== "string" || !edge.id || edgeIds.has(edge.id)
          || typeof edge.fromNode !== "string" || typeof edge.toNode !== "string") throw new Error("连线格式无效或标识重复");
      edgeIds.add(edge.id);
    }
    return { ...value, nodes: nodes as CanvasNode[], edges: edges as Record<string, unknown>[] };
  } catch (error) {
    throw new Error(`画布数据无法安全读取，原文件已保留。${error instanceof Error ? error.message : ""}`);
  }
}

export function annotationNodeId(annotation: Annotation): string { return `leafmark-${annotation.id}`; }

export function sourceLink(annotation: Annotation, vaultName: string): string {
  const query = new URLSearchParams({ vault: vaultName, book: annotation.bookPath, annotation: annotation.id, cfi: annotation.cfiRange });
  return `obsidian://leafmark?${query.toString()}`;
}

function markdownText(text: string): string { return text.replace(/[\\`*_{}[\]<>#!|]/g, "\\$&"); }

// This checksum detects edits, not authenticity. A changed generated block becomes user-owned.
function checksum(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function annotationCardText(annotation: Annotation, vaultName: string): string {
  const title = annotation.bookPath.split("/").pop()!.replace(/\.epub$/i, "");
  const quote = markdownText(annotation.quote).split("\n").map(line => `> ${line}`).join("\n");
  const thought = annotation.thought?.trim() ? `\n\n**想法**\n\n${markdownText(annotation.thought)}` : "";
  const body = `${quote}${thought}\n\n${markdownText(title)}${annotation.chapter ? ` · ${markdownText(annotation.chapter)}` : ""}\n\n[返回原文](${sourceLink(annotation, vaultName)})`;
  return `<!-- leafmark:${annotation.id}:${checksum(body)} -->\n${body}\n<!-- /leafmark:${annotation.id} -->`;
}

function refreshCardText(current: string, annotation: Annotation, vaultName: string): string {
  const marker = new RegExp(`<!-- leafmark:${annotation.id}:([0-9a-f]{8}) -->\\n([\\s\\S]*?)\\n<!-- /leafmark:${annotation.id} -->`);
  const match = marker.exec(current);
  if (!match || checksum(match[2]) !== match[1]) return current;
  return current.slice(0, match.index) + annotationCardText(annotation, vaultName) + current.slice(match.index + match[0].length);
}

const canvasColors = { yellow: "3", red: "1", green: "4", blue: "5", purple: "6" } as const;

export function findAnnotationNode(document: CanvasDocument, annotation: Annotation): CanvasNode | undefined {
  const matches = document.nodes.filter(node => node.id === annotationNodeId(annotation)
    || (record(node.leafmark) && node.leafmark.annotationId === annotation.id && node.leafmark.bookPath === annotation.bookPath));
  if (matches.length > 1) throw new Error("多张画布卡片关联同一摘录，请先检查重复卡片，未自动选择。");
  return matches[0];
}

export function upsertAnnotation(document: CanvasDocument, annotation: Annotation, vaultName: string): CanvasDocument {
  validateAnnotation(annotation, annotation.bookPath);
  const id = annotationNodeId(annotation);
  const existing = findAnnotationNode(document, annotation);
  const metadata = { annotationId: annotation.id, bookPath: annotation.bookPath, cfiRange: annotation.cfiRange, updatedAt: annotation.updatedAt };
  if (existing) {
    if (existing.type !== "text" || typeof existing.text !== "string") throw new Error("摘录卡片标识已被其他节点使用，未修改画布。");
    const updated: CanvasNode = { ...existing, text: refreshCardText(existing.text, annotation, vaultName), leafmark: metadata };
    // A manually recolored card keeps its own color; ordinary highlight changes still propagate.
    const previous = record(existing.leafmark) ? existing.leafmark : undefined;
    const managedColor = typeof previous?.generatedColor === "string" && previous.generatedColor === existing.color;
    if (managedColor) updated.color = canvasColors[annotation.color];
    updated.leafmark = { ...previous, ...metadata, generatedColor: managedColor ? updated.color : previous?.generatedColor };
    return { ...document, nodes: document.nodes.map(node => node === existing ? updated : node) };
  }
  const right = document.nodes.reduce((max, node) => Math.max(max, node.x + node.width), -80);
  const node: CanvasNode = {
    id, type: "text", x: Math.ceil(right + 80), y: 0, width: 380,
    height: Math.min(900, Math.max(240, 140 + Math.ceil((annotation.quote.length + (annotation.thought?.length ?? 0)) / 20) * 26)),
    text: annotationCardText(annotation, vaultName), color: canvasColors[annotation.color],
    leafmark: { ...metadata, generatedColor: canvasColors[annotation.color] },
  };
  return { ...document, nodes: [...document.nodes, node] };
}

interface FocusCanvas {
  nodes: Map<string, unknown>;
  selectOnly(node: unknown): void;
  zoomToSelection(): void;
  readonly?: boolean;
}

type CanvasView = TextFileView & { canvas?: Partial<FocusCanvas> };
interface CanvasEdit<T> { document: CanvasDocument; result: T; saveUnchangedView?: boolean; }

export class CanvasService {
  constructor(private readonly app: App) {}

  private leaves(path: string): WorkspaceLeaf[] {
    return this.app.workspace.getLeavesOfType("canvas").filter(leaf => {
      const view = leaf.view as Partial<CanvasView>;
      return view.file?.path === path || leaf.getViewState().state?.file === path;
    });
  }

  private oneOpenLeaf(path: string): WorkspaceLeaf | undefined {
    const leaves = this.leaves(path);
    if (leaves.length > 1) throw new Error("此画布在多个窗格中打开。请保留一个画布窗格后重试，以免覆盖其他窗格的编辑。");
    return leaves[0];
  }

  private editableView(leaf: WorkspaceLeaf): CanvasView {
    const view = leaf.view as CanvasView;
    if (typeof view.getViewData !== "function" || typeof view.setViewData !== "function" || typeof view.save !== "function") {
      throw new Error("当前 Obsidian 版本未提供可安全更新的画布接口，请关闭此画布后重试。");
    }
    if (view.canvas?.readonly) throw new Error("此画布为只读，请解除只读后重试。");
    return view;
  }

  private async backup(path: string, text: string): Promise<void> {
    const backupPath = `${path}.leafmark-backup.json`;
    if (this.app.vault.getFileByPath(backupPath)) return;
    if (this.app.vault.getAbstractFileByPath(backupPath)) throw new Error(`备份路径被占用：${backupPath}`);
    try { await this.app.vault.create(backupPath, text); }
    catch (error) { throw new Error(`无法保存画布备份，未同步摘录。${error instanceof Error ? error.message : ""}`); }
  }

  private edit<T>(canvasPath: string, change: (document: CanvasDocument) => CanvasEdit<T>): Promise<T> {
    vaultPath(canvasPath);
    return serializeVaultWrite(this.app.vault, canvasPath, async () => {
      const file = requireFile(this.app.vault, canvasPath, "canvas");
      const leaf = this.oneOpenLeaf(canvasPath);
      if (leaf) {
        const view = this.editableView(leaf);
        const snapshot = view.getViewData();
        const initial = parseCanvas(snapshot);
        const preview = change(initial);
        if (preview.document === initial && !preview.saveUnchangedView) return preview.result;
        await this.backup(canvasPath, snapshot);
        if (this.oneOpenLeaf(canvasPath) !== leaf || leaf.view !== view) throw new Error("画布窗格已改变，请重试同步。");
        // Re-read after the asynchronous backup so typing during it is never overwritten.
        const latest = parseCanvas(view.getViewData());
        const updated = change(latest);
        if (updated.document === latest && !updated.saveUnchangedView) return updated.result;
        if (updated.document !== latest) view.setViewData(JSON.stringify(updated.document, null, 2), false);
        await view.save();
        return updated.result;
      } else {
        const snapshot = await this.app.vault.read(file);
        const initial = parseCanvas(snapshot);
        const preview = change(initial);
        if (preview.document === initial) return preview.result;
        await this.backup(canvasPath, snapshot);
        if (this.oneOpenLeaf(canvasPath)) throw new Error("画布刚刚被打开，请重试同步。");
        let result!: T;
        await this.app.vault.process(file, text => {
          if (this.oneOpenLeaf(canvasPath)) throw new Error("画布刚刚被打开，请重试同步。");
          const latest = parseCanvas(text);
          const updated = change(latest);
          result = updated.result;
          return updated.document === latest ? text : JSON.stringify(updated.document, null, 2) + "\n";
        });
        return result;
      }
    });
  }

  syncAnnotation(annotation: Annotation, canvasPath: string): Promise<string> {
    return this.edit(canvasPath, document => {
      const updated = upsertAnnotation(document, annotation, this.app.vault.getName());
      return { document: updated, result: findAnnotationNode(updated, annotation)!.id };
    });
  }

  adoptLegacyAnnotation(annotation: Annotation, canvasPath: string): Promise<boolean> {
    validateAnnotation(annotation, annotation.bookPath);
    return this.edit(canvasPath, document => {
      const matches = document.nodes.filter(node => record(node.epubCanvas)
        && node.epubCanvas.book === annotation.bookPath && node.epubCanvas.cfi === annotation.cfiRange);
      if (matches.length > 1) throw new Error("多张旧卡片匹配此摘录，无法确定关联对象，未修改画布。");
      if (!matches.length) return { document, result: false };
      const target = matches[0];
      if (target.type !== "text") throw new Error("匹配的旧节点不是文字卡片，未修改画布。");
      const associated = findAnnotationNode(document, annotation);
      if (associated && associated !== target) throw new Error("此摘录已关联另一张卡片，未修改旧卡片。");
      if (target.leafmark !== undefined && !record(target.leafmark)) throw new Error("旧卡片的关联数据格式不明，未覆盖。");
      const previous = record(target.leafmark) ? target.leafmark : {};
      if ((previous.annotationId !== undefined && previous.annotationId !== annotation.id)
          || (previous.bookPath !== undefined && previous.bookPath !== annotation.bookPath)
          || (previous.cfiRange !== undefined && previous.cfiRange !== annotation.cfiRange)) {
        throw new Error("旧卡片已有不同的摘录关联，未覆盖。");
      }
      if (previous.annotationId === annotation.id && previous.bookPath === annotation.bookPath && previous.cfiRange === annotation.cfiRange) {
        // A previous save may have failed after these fields were added to the live view.
        return { document, result: true, saveUnchangedView: true };
      }
      const updated = { ...target, leafmark: { ...previous, annotationId: annotation.id, bookPath: annotation.bookPath, cfiRange: annotation.cfiRange } };
      return { document: { ...document, nodes: document.nodes.map(node => node === target ? updated : node) }, result: true };
    }).then(async adopted => {
      if (!adopted) return false;
      const saved = parseCanvas(await this.app.vault.read(requireFile(this.app.vault, canvasPath, "canvas")));
      const node = findAnnotationNode(saved, annotation);
      if (!node || !record(node.leafmark) || node.leafmark.cfiRange !== annotation.cfiRange
          || node.leafmark.annotationId !== annotation.id || node.leafmark.bookPath !== annotation.bookPath) {
        throw new Error("摘录关联尚未写入画布文件，当前编辑仍保留，请重试。");
      }
      return true;
    });
  }

  async openCanvas(canvasPath: string): Promise<WorkspaceLeaf> {
    const file = requireFile(this.app.vault, canvasPath, "canvas");
    let leaf = this.oneOpenLeaf(canvasPath);
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("split", "vertical");
      await leaf.openFile(file, { active: true });
    }
    await leaf.loadIfDeferred();
    await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  async focusAnnotation(annotation: Annotation, canvasPath: string): Promise<void> {
    const leaf = await this.openCanvas(canvasPath);
    const view = leaf.view as CanvasView;
    const canvas = view.canvas;
    // Native Canvas exposes no public node-focus API. Never silently report a successful focus.
    if (!canvas?.nodes || typeof canvas.nodes.get !== "function" || typeof view.getViewData !== "function"
        || typeof canvas.selectOnly !== "function" || typeof canvas.zoomToSelection !== "function") {
      throw new Error("画布已打开，但当前 Obsidian 版本不支持定位摘录卡片。");
    }
    const linked = findAnnotationNode(parseCanvas(view.getViewData()), annotation);
    const node = linked && canvas.nodes.get(linked.id);
    if (!node) throw new Error("画布中没有这条摘录卡片，请先同步摘录。");
    canvas.selectOnly(node);
    canvas.zoomToSelection();
  }
}
