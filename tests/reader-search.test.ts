// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReaderView } from '../src/reader';
import { configureLanguage, t } from '../src/i18n';

vi.mock('../src/migration-ui', () => ({ chooseLegacyExcerpts: vi.fn() }));

// Obsidian adds these small DOM helpers to the host window.
const descriptors = new Map<string, PropertyDescriptor | undefined>();
beforeAll(() => {
  const helpers = {
    createEl(this: HTMLElement, tag: string, options: Record<string, any> = {}) {
      const element = this.ownerDocument.createElement(tag);
      if (options.cls) element.className = options.cls;
      if (options.text !== undefined) element.textContent = options.text;
      if (options.type) element.setAttribute('type', options.type);
      for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, String(value));
      this.append(element);
      return element;
    },
    createDiv(this: HTMLElement, options: Record<string, any> = {}) { return this.createEl('div', options); },
    createSpan(this: HTMLElement, options: Record<string, any> = {}) { return this.createEl('span', options); },
    addClass(this: HTMLElement, name: string) { this.classList.add(name); },
    removeClass(this: HTMLElement, name: string) { this.classList.remove(name); },
    hasClass(this: HTMLElement, name: string) { return this.classList.contains(name); },
    toggleClass(this: HTMLElement, name: string, enabled: boolean) { this.classList.toggle(name, enabled); },
    empty(this: HTMLElement) { this.replaceChildren(); },
    appendText(this: HTMLElement, text: string) { this.append(this.ownerDocument.createTextNode(text)); },
  };
  for (const [name, helper] of Object.entries(helpers)) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: helper });
  }
});
afterAll(() => {
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete (HTMLElement.prototype as any)[name];
  }
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); configureLanguage('en'); });

function reader() {
  // Search uses no vault writes; the FileView host only supplies contentEl here.
  const view = new ReaderView({} as never, {} as never) as any;
  view.file = { path: 'book.epub', basename: 'Book' };
  view.build();
  document.body.append(view.contentEl);
  const engine = {
    search: vi.fn().mockResolvedValue([]), goToCFI: vi.fn().mockResolvedValue(undefined),
    setSearchHighlight: vi.fn(), resize: vi.fn(), destroy: vi.fn(), getToc: () => [],
  };
  Object.assign(view, { engine, bookLoaded: true });
  return { view, engine, content: view.contentEl as HTMLElement };
}

const hits = [
  { cfi: 'first-cfi', excerpt: 'A needle in the first chapter.', chapter: 'First', sectionHref: 'one.xhtml', sectionIndex: 0 },
  { cfi: 'second-cfi', excerpt: 'Another needle.', chapter: 'Second', sectionHref: 'two.xhtml', sectionIndex: 1 },
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('book search controls', () => {
  it('opens the search tab from the toolbar and focuses its input', () => {
    const { view, engine, content } = reader();
    const button = content.querySelector<HTMLButtonElement>('.lm-toolbar [data-i18n="search"]');
    expect(button).not.toBeNull();
    button!.click();
    expect(view.panel.hidden).toBe(false);
    expect(view.panelMode).toBe('search');
    expect(document.activeElement).toBe(content.querySelector('.lm-search-input'));
    expect(engine.resize).toHaveBeenCalled();
  });

  it('renders repeated case-insensitive matches as safe text and marks', () => {
    const { view } = reader();
    const parent = document.createElement('div');
    const excerpt = '<img src=x onerror=alert(1)> NEEDLE <script>needle</script>';
    view.appendSearchExcerpt(parent, excerpt, 'needle');
    expect(parent.textContent).toBe(excerpt);
    expect(parent.querySelector('img, script')).toBeNull();
    expect(Array.from(parent.querySelectorAll('mark.lm-search-mark'), mark => mark.textContent)).toEqual(['NEEDLE', 'needle']);
    const punctuation = document.createElement('div');
    view.appendSearchExcerpt(punctuation, 'a+b and a+b', 'a+b');
    expect(punctuation.querySelectorAll('mark')).toHaveLength(2);
  });

  it('searches on Enter, cycles through hits, and clears on Escape', async () => {
    const { view, engine, content } = reader();
    engine.search.mockResolvedValue(hits);
    view.openSearch();
    let input = content.querySelector<HTMLInputElement>('.lm-search-input')!;
    input.value = 'needle';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(engine.setSearchHighlight).toHaveBeenCalledWith(hits[0].cfi));
    expect(engine.search).toHaveBeenCalledWith('needle');
    expect(content.querySelector('.lm-search-status')?.textContent).toBe('1 / 2');
    expect(content.querySelector('.lm-search-result.is-active')?.textContent).toContain('First');
    const firstRow = content.querySelector('.lm-search-result');
    const previous = content.querySelector<HTMLButtonElement>('[data-i18n="previousMatch"]')!;
    previous.focus();previous.click();
    await vi.waitFor(() => expect(engine.setSearchHighlight).toHaveBeenLastCalledWith(hits[1].cfi));
    expect(engine.goToCFI).toHaveBeenLastCalledWith(hits[1].cfi);
    expect(content.querySelector('.lm-search-status')?.textContent).toBe('2 / 2');
    expect(content.querySelector('.lm-search-result')).toBe(firstRow);
    expect(document.activeElement).toBe(previous);
    content.querySelector<HTMLButtonElement>('[data-i18n="nextMatch"]')!.click();
    await vi.waitFor(() => expect(engine.setSearchHighlight).toHaveBeenLastCalledWith(hits[0].cfi));
    expect(engine.goToCFI).toHaveBeenLastCalledWith(hits[0].cfi);
    const secondRow = content.querySelectorAll<HTMLButtonElement>('.lm-search-result')[1];
    secondRow.focus();secondRow.click();
    await vi.waitFor(() => expect(engine.setSearchHighlight).toHaveBeenLastCalledWith(hits[1].cfi));
    expect(secondRow.classList.contains('is-active')).toBe(true);
    expect(document.activeElement).toBe(secondRow);
    input = content.querySelector<HTMLInputElement>('.lm-search-input')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(view.searchHits).toEqual([]);
    expect(content.querySelector<HTMLInputElement>('.lm-search-input')?.value).toBe('');
    expect(engine.setSearchHighlight).toHaveBeenLastCalledWith();
    expect(content.querySelector('.lm-search-result')).toBeNull();
  });

  it('shows the empty state and disables navigation for an unmatched query', async () => {
    const { view, content } = reader();
    view.openSearch();
    await view.runBookSearch('absent');
    expect(content.querySelector('.lm-search-status')?.textContent).toBe(t('noSearchMatches'));
    expect(content.querySelector<HTMLButtonElement>('[data-i18n="previousMatch"]')?.disabled).toBe(true);
    expect(content.querySelector<HTMLButtonElement>('[data-i18n="nextMatch"]')?.disabled).toBe(true);
  });
});

describe('book search cancellation', () => {
  it('discards a cleared search and waits for its section loads before starting the next', async () => {
    const { view, engine } = reader();
    const old = deferred<typeof hits>();
    engine.search.mockReturnValueOnce(old.promise).mockResolvedValueOnce([hits[1]]);
    const first = view.runBookSearch('first');
    await vi.waitFor(() => expect(engine.search).toHaveBeenCalledTimes(1));
    view.clearBookSearch();
    const second = view.runBookSearch('second');
    await Promise.resolve();
    expect(engine.search).toHaveBeenCalledTimes(1);
    old.resolve([hits[0]]);
    await Promise.all([first, second]);
    expect(engine.search.mock.calls).toEqual([['first'], ['second']]);
    expect(view.searchHits).toEqual([hits[1]]);
    expect(engine.goToCFI).toHaveBeenCalledTimes(1);
    expect(engine.goToCFI).toHaveBeenCalledWith(hits[1].cfi);
  });

  it('does not restore a highlight after a pending jump is cleared', async () => {
    const { view, engine } = reader();
    const navigation = deferred<void>();
    view.searchHits = hits;
    engine.goToCFI.mockReturnValueOnce(navigation.promise);
    const jump = view.jumpToSearchHit(0);
    view.clearBookSearch();
    engine.setSearchHighlight.mockClear();
    navigation.resolve();
    await jump;
    expect(engine.setSearchHighlight).not.toHaveBeenCalledWith(hits[0].cfi);
    expect(view.searchHits).toEqual([]);
  });

  it('clears results and temporary highlights when the book is unloaded', async () => {
    const { view, engine } = reader();
    view.searchQuery = view.searchTerm = 'needle';
    view.searchHits = hits;
    await view.onUnloadFile(view.file);
    expect(view.searchQuery).toBe('');
    expect(view.searchHits).toEqual([]);
    expect(engine.setSearchHighlight).toHaveBeenCalledWith();
    expect(engine.destroy).toHaveBeenCalled();
  });
});
