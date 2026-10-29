export type LanguagePreference = 'auto' | 'zh' | 'en';
export type Language = 'zh' | 'en';
export type TranslationVars = Record<string, string | number>;

const en = {
  supportInlineDescription:'If Leafmark helps your reading, you can support its development. All features remain free. Tap a code to enlarge it.', wechatPay:'WeChat Pay', alipay:'Alipay', enlargeQr:'Enlarge {name} QR code', supportVerify:'Verify the recipient in your payment app before paying.',
  supportDevelopment:'Project and support', supportDescription:'Report a problem or support continued development.', supportOpen:'Open project',
  legacyChoose:'Choose a Markdown excerpt file', legacyImport:'Import earlier excerpts',
  legacySummary:'Found {count} excerpts. Original notes and Canvas cards are kept. Matching cards will be linked without creating duplicates.',
  legacyWarnings:'{count} blocks need manual review. Nothing will be imported until they are resolved.', legacyDone:'Excerpts imported. Original files and card layout were kept.',

  readerName: 'Leafmark Reader', openBook: 'Open EPUB', ribbonOpenBook: 'Leafmark: Open EPUB',
  pickBook: 'Choose an EPUB', pickCanvas: 'Choose a Canvas for excerpts', noBooks: 'No EPUB files found', noCanvases: 'No Canvas files found',
  chaptersAndExcerpts: 'Chapters and excerpts', openABook: 'Open a book', connectCanvas: 'Connect Canvas', canvas: 'Canvas',
  readingOptions: 'Reading options', previousSection: 'Previous section', nextSection: 'Next section', readingNavigation: 'Reading navigation',
  chapters: 'Contents', excerpts: 'Excerpts', typography: 'Layout', startReading: 'Choose an EPUB to start reading', retry: 'Retry',
  openingBook: 'Opening book…', opening: 'Opening…', canvasConnected: 'Canvas connected', noCanvas: 'No Canvas connected',
  cannotOpenBook: 'Unable to open this book\n{error}', canvasFileSuffix: 'Reading Canvas', syncingCanvas: 'Syncing Canvas…', syncedExcerpts: 'Synced {count} excerpts',
  openAnotherBook: 'Open another book', chooseExcerptCanvas: 'Choose excerpt Canvas', createBookCanvas: 'Create Canvas for this book',
  resyncExcerpts: 'Sync excerpts again', readingLayout: 'Reading layout', highlight: 'Highlight', writeThought: 'Write a thought',
  saving: 'Saving…', excerptAndCanvasSaved: 'Excerpt and Canvas saved', excerptSavedCanvasFailed: 'Excerpt saved; Canvas sync failed: {error}',
  excerptSavedConnectCanvas: 'Excerpt saved · Connect a Canvas to sync it', saveFailed: 'Save failed: {error}', thoughtSaved: 'Thought saved',
  viewInCanvas: 'View in Canvas', editThought: 'Edit thought', removeHighlight: 'Remove highlight', highlightRemoved: 'Highlight removed; Canvas card kept',
  fontSize: 'Text size', appearance: 'Appearance', readingAppearance: 'Reading appearance', followObsidian: 'Follow Obsidian', light: 'Light', dark: 'Dark',
  language: 'Interface language', languageDescription: 'Book text, quotes, thoughts, and existing filenames stay as written.',
  searchExcerpts: 'Search excerpts', all: 'All', highlights: 'Highlights', thoughts: 'Thoughts', noMatches: 'No matching excerpts',
  search: 'Search book', searchPlaceholder: 'Search this book…', clearSearch: 'Clear search', searchBook: 'Search',
  previousMatch: 'Previous match', nextMatch: 'Next match', searching: 'Searching…', noSearchMatches: 'No matching results',
  searchCount: '{current} / {total}', searchHint: 'Enter a keyword and press Enter to search.', searchResults: 'Search results',
  searchCountIncomplete: '{current} / {total} (incomplete search)', searchIncomplete: 'Search results are incomplete. Sections that could not be read: {count}.',
  noExcerpts: 'Select a passage to highlight it or write a thought.', noChapters: 'This book has no table of contents.', sourceText: 'Source text',
  backToSource: 'Back to source', thoughtHeading: 'Write a thought', thoughtPlaceholder: 'What came to mind?', thought: 'Thought', cancel: 'Cancel', saveThought: 'Save thought',
  errorWrongVault: 'Open this link in the vault where the excerpt was saved.', errorMissingLocation: 'This link has no usable source location.',
  errorMissingBook: 'This EPUB could not be found. Check that it is still in this vault.', errorBookNotOpen: 'Open a book first.',
  errorUnknown: 'The action could not be completed. Please try again and check that the book and destination files are available.',
  errorPath: 'Choose a valid file inside this vault.', errorAnnotationData: 'The excerpt data is incomplete or invalid.',
  errorBookData: 'The saved reading data could not be read safely. The original file has been kept; check or restore it before trying again.',
  errorMissingFile: 'The selected file could not be found. Please select it again.', errorMissingCanvas: 'The selected Canvas could not be found. Please select it again.',
  errorDataFolder: 'A folder occupies the reading data file location. Rename that folder and try again.',
  errorMissingAnnotation: 'This excerpt no longer exists. It may have changed in another window.', errorPositionSave: 'The reading position is invalid and was not saved.',
  errorExternalResource: 'This book tried to load an external resource. External resources are blocked.',
  errorFixedLayout: 'This book uses a fixed layout. Please use a reflowable EPUB with this reader.',
  errorExcerptLocation: 'The source position of this excerpt is invalid.', errorChapter: 'This chapter could not be found in the book.',
  errorHighlightLocation: 'One excerpt has an invalid source position. Its record was kept, but its highlight could not be shown.',
  errorBookLoading: 'The book has not finished loading yet.',
  errorSearchFailed: 'No sections could be read. The book search failed.',
  errorCanvasData: 'The Canvas could not be read safely. The original file has been kept; check or restore it before syncing.',
  errorDuplicateCards: 'Multiple Canvas cards are linked to this excerpt. Resolve the duplicates before syncing.',
  errorCardConflict: 'The excerpt card conflicts with another Canvas item. The Canvas was not changed.',
  errorMultiplePanes: 'This Canvas is open in multiple panes. Leave one Canvas pane open and try again to protect your edits.',
  errorCanvasInterface: 'This version of Obsidian cannot safely update an open Canvas. Close the Canvas and try again.',
  errorCanvasReadOnly: 'This Canvas is read-only. Allow editing and try again.', errorBackupPath: 'The Canvas backup location is occupied. Check it before syncing again.',
  errorBackupFailed: 'A Canvas backup could not be saved, so excerpts were not synced. Check the available storage and file permissions.',
  errorCanvasChanged: 'The Canvas pane changed. Please sync again.', errorCanvasOpened: 'The Canvas was just opened. Please sync again.',
  errorLegacyDuplicates: 'Multiple existing cards match this excerpt. The Canvas was not changed.', errorLegacyNotText: 'The matching item is not a text card. The Canvas was not changed.',
  errorLegacyAssociation: 'This excerpt or card already has a different link. The existing card was not changed.', errorLegacyMetadata: 'The existing card link could not be read safely and was not replaced.',
  errorCanvasFocus: 'The Canvas is open, but this version of Obsidian cannot focus an excerpt card.', errorNoCanvasCard: 'This excerpt has no Canvas card yet. Sync the excerpts first.',
} as const;
export type TranslationKey = keyof typeof en;
const zh: Record<TranslationKey, string> = {
  supportInlineDescription:'如果 Leafmark 对你的阅读有帮助，欢迎支持持续开发。所有功能免费使用，点击收款码可放大。', wechatPay:'微信支付', alipay:'支付宝', enlargeQr:'放大{name}收款码', supportVerify:'付款前请在支付应用中核对收款人。',
  supportDevelopment:'项目与支持', supportDescription:'反馈问题，或支持插件持续开发。', supportOpen:'打开项目',
  legacyChoose:'选择已有的 Markdown 摘录文件', legacyImport:'导入已有摘录',
  legacySummary:'找到 {count} 条摘录。原笔记和白板卡片会保留；匹配的卡片将直接关联，不重复创建。',
  legacyWarnings:'有 {count} 个段落需要人工检查；处理完成前不会执行导入。', legacyDone:'摘录已导入，原文件和卡片排版已保留。',

  readerName: 'Leafmark 阅读器', openBook: '打开 EPUB', ribbonOpenBook: 'Leafmark：打开 EPUB',
  pickBook: '选择一本 EPUB', pickCanvas: '选择接收摘录的白板', noBooks: '没有找到 EPUB 文件', noCanvases: '没有找到白板文件',
  chaptersAndExcerpts: '章节与摘录', openABook: '打开一本书', connectCanvas: '连接白板', canvas: '白板',
  readingOptions: '阅读选项', previousSection: '上一节', nextSection: '下一节', readingNavigation: '阅读导航',
  chapters: '目录', excerpts: '摘录', typography: '排版', startReading: '选择 EPUB 开始阅读', retry: '重试',
  openingBook: '正在打开书籍…', opening: '正在打开…', canvasConnected: '已连接白板', noCanvas: '尚未连接白板',
  cannotOpenBook: '无法打开这本书\n{error}', canvasFileSuffix: '阅读白板', syncingCanvas: '正在同步白板…', syncedExcerpts: '已同步 {count} 条摘录',
  openAnotherBook: '打开另一本书', chooseExcerptCanvas: '选择摘录白板', createBookCanvas: '新建本书白板',
  resyncExcerpts: '重新同步摘录', readingLayout: '阅读排版', highlight: '划线', writeThought: '写想法',
  saving: '正在保存…', excerptAndCanvasSaved: '摘录与白板已保存', excerptSavedCanvasFailed: '摘录已保存，白板未同步：{error}',
  excerptSavedConnectCanvas: '摘录已保存 · 连接白板后自动同步', saveFailed: '保存失败：{error}', thoughtSaved: '想法已保存',
  viewInCanvas: '在白板查看', editThought: '编辑想法', removeHighlight: '移除划线', highlightRemoved: '划线已移除，白板卡片保留',
  fontSize: '文字大小', appearance: '外观', readingAppearance: '阅读外观', followObsidian: '跟随 Obsidian', light: '浅色', dark: '深色',
  language: '界面语言', languageDescription: '书籍正文、摘录、想法和已有文件名保持原样。',
  searchExcerpts: '搜索摘录', all: '全部', highlights: '划线', thoughts: '想法', noMatches: '没有匹配的摘录',
  search: '全文搜索', searchPlaceholder: '搜索整本书…', clearSearch: '清空搜索', searchBook: '搜索',
  previousMatch: '上一个匹配', nextMatch: '下一个匹配', searching: '搜索中…', noSearchMatches: '无匹配结果',
  searchCount: '{current} / {total}', searchHint: '输入关键词，按 Enter 搜索。', searchResults: '搜索结果',
  searchCountIncomplete: '{current} / {total}（部分章节未能搜索）', searchIncomplete: '有 {count} 个章节未能读取，搜索结果不完整。',
  noExcerpts: '选中一段原文，开始划线或写想法。', noChapters: '这本书没有目录。', sourceText: '原文',
  backToSource: '返回原文', thoughtHeading: '写下想法', thoughtPlaceholder: '你想到了什么？', thought: '想法', cancel: '取消', saveThought: '保存想法',
  errorWrongVault: '请在这条摘录所属的笔记库中打开链接。', errorMissingLocation: '此链接没有可用的原文位置。',
  errorMissingBook: '找不到这本 EPUB，请确认它仍在当前笔记库中。', errorBookNotOpen: '请先打开一本书。',
  errorUnknown: '操作未能完成。请重试，并确认书籍和目标文件仍然可用。',
  errorPath: '请选择当前笔记库内的有效文件。', errorAnnotationData: '摘录数据不完整或格式无效。',
  errorBookData: '无法安全读取已保存的阅读数据。原文件已保留，请检查或恢复数据后重试。',
  errorMissingFile: '找不到所选文件，请重新选择。', errorMissingCanvas: '找不到所选白板，请重新选择。',
  errorDataFolder: '阅读数据文件的位置被文件夹占用，请重命名该文件夹后重试。',
  errorMissingAnnotation: '找不到这条摘录，数据可能已在另一窗口更新。', errorPositionSave: '阅读位置无效，未保存。',
  errorExternalResource: '这本书尝试加载外部资源，已阻止该请求。', errorFixedLayout: '这本书采用固定版式；当前阅读器支持可重排的 EPUB，请使用可重排版本。',
  errorExcerptLocation: '这条摘录的原文位置无效。', errorChapter: '书中找不到这个章节。',
  errorHighlightLocation: '有一条摘录的位置无效，已保留记录但未绘制高亮。', errorBookLoading: '电子书尚未加载完成。',
  errorSearchFailed: '无法读取任何章节，全文搜索失败。',
  errorCanvasData: '无法安全读取白板数据。原文件已保留，请检查或恢复数据后再同步。',
  errorDuplicateCards: '多张白板卡片关联同一摘录，请先处理重复卡片再同步。', errorCardConflict: '摘录卡片与其他白板内容冲突，未修改白板。',
  errorMultiplePanes: '此白板在多个窗格中打开。请保留一个白板窗格后重试，以免覆盖其他窗格的编辑。',
  errorCanvasInterface: '当前 Obsidian 版本无法安全更新已打开的白板，请关闭此白板后重试。',
  errorCanvasReadOnly: '此白板为只读，请解除只读后重试。', errorBackupPath: '白板备份位置被占用，请检查后重新同步。',
  errorBackupFailed: '无法保存白板备份，未同步摘录。请检查可用空间和文件权限。', errorCanvasChanged: '白板窗格已改变，请重试同步。', errorCanvasOpened: '白板刚刚被打开，请重试同步。',
  errorLegacyDuplicates: '多张已有卡片匹配此摘录，未修改白板。', errorLegacyNotText: '匹配的已有内容不是文字卡片，未修改白板。',
  errorLegacyAssociation: '此摘录或卡片已有不同的关联，未修改已有卡片。', errorLegacyMetadata: '无法安全读取已有卡片的关联数据，未覆盖。',
  errorCanvasFocus: '白板已打开，但当前 Obsidian 版本不支持定位摘录卡片。', errorNoCanvasCard: '白板中没有这条摘录卡片，请先同步摘录。',
};
export const messages = { en, zh };
let language: Language = 'en';
const listeners = new Set<() => void>();
export function resolveLanguage(preference: LanguagePreference, obsidianLanguage = 'en'): Language {
  if (preference === 'zh' || preference === 'en') return preference;
  return /^zh(?:[-_]|$)/i.test(obsidianLanguage) ? 'zh' : 'en';
}
export function resolvedLanguage(): Language { return language; }
export function configureLanguage(preference: LanguagePreference, obsidianLanguage = 'en'): void {
  const next = resolveLanguage(preference, obsidianLanguage);
  if (next === language) return;
  language = next;
  for (const listener of listeners) listener();
}
export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function t(key: TranslationKey, vars: TranslationVars = {}): string {
  const template = messages[language][key] || en[key] || key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => Object.hasOwn(vars, name) ? String(vars[name]) : placeholder);
}

// Keep persistence and safety errors useful without exposing parser details or raw paths.
const errorMessages: [string | RegExp, TranslationKey][] = [
  ['文件路径无效，请选择库内文件。', 'errorPath'], ['摘录数据不完整或格式无效。', 'errorAnnotationData'],
  [/^无法读取 .*\.leafmark\.json；原文件已保留，请检查数据。/s, 'errorBookData'],
  [/^找不到画布：/, 'errorMissingCanvas'], [/^找不到文件：/, 'errorMissingFile'], [/^数据路径被文件夹占用：/, 'errorDataFolder'],
  [/^找不到这条摘录[，。]/, 'errorMissingAnnotation'], ['阅读位置无效，未保存。', 'errorPositionSave'],
  ['电子书不能请求外部资源。', 'errorExternalResource'], ['这本书采用固定版式；当前阅读器支持可重排的 EPUB，请使用可重排版本。', 'errorFixedLayout'],
  ['这条摘录的阅读位置无效。', 'errorExcerptLocation'], ['书中找不到这个章节。', 'errorChapter'],
  ['有一条摘录的位置无效，已保留记录但未绘制高亮。', 'errorHighlightLocation'], ['电子书尚未加载完成。', 'errorBookLoading'],
  ['无法读取任何章节，全文搜索失败。', 'errorSearchFailed'],
  ['书籍尚未打开。', 'errorBookNotOpen'], [/^画布数据无法安全读取，原文件已保留。/, 'errorCanvasData'],
  ['多张画布卡片关联同一摘录，请先检查重复卡片，未自动选择。', 'errorDuplicateCards'],
  ['摘录卡片标识已被其他节点使用，未修改画布。', 'errorCardConflict'],
  ['此画布在多个窗格中打开。请保留一个画布窗格后重试，以免覆盖其他窗格的编辑。', 'errorMultiplePanes'],
  ['当前 Obsidian 版本未提供可安全更新的画布接口，请关闭此画布后重试。', 'errorCanvasInterface'],
  ['此画布为只读，请解除只读后重试。', 'errorCanvasReadOnly'], [/^备份路径被占用：/, 'errorBackupPath'],
  [/^无法保存画布备份，未同步摘录。/, 'errorBackupFailed'], ['画布窗格已改变，请重试同步。', 'errorCanvasChanged'], ['画布刚刚被打开，请重试同步。', 'errorCanvasOpened'],
  ['多张旧卡片匹配此摘录，无法确定关联对象，未修改画布。', 'errorLegacyDuplicates'], ['匹配的旧节点不是文字卡片，未修改画布。', 'errorLegacyNotText'],
  ['此摘录已关联另一张卡片，未修改旧卡片。', 'errorLegacyAssociation'], ['旧卡片已有不同的摘录关联，未覆盖。', 'errorLegacyAssociation'],
  ['旧卡片的关联数据格式不明，未覆盖。', 'errorLegacyMetadata'], ['画布已打开，但当前 Obsidian 版本不支持定位摘录卡片。', 'errorCanvasFocus'],
  ['画布中没有这条摘录卡片，请先同步摘录。', 'errorNoCanvasCard'],
];
export function friendlyError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  for (const [match, key] of errorMessages) if (typeof match === 'string' ? text === match : match.test(text)) return t(key);
  for (const key of Object.keys(en) as TranslationKey[]) {
    if (key.startsWith('error') && (text === en[key] || text === zh[key])) return t(key);
  }
  return t('errorUnknown');
}
