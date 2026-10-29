import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureLanguage, friendlyError, messages, onLanguageChange, resolvedLanguage, resolveLanguage, t, type TranslationKey } from '../src/i18n';

afterEach(() => configureLanguage('en'));

describe('interface localization', () => {
  it('has matching, nonempty English and Chinese keys and interpolation fields', () => {
    expect(Object.keys(messages.zh).sort()).toEqual(Object.keys(messages.en).sort());
    const fields = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const key of Object.keys(messages.en) as TranslationKey[]) {
      expect(messages.en[key].trim(), key).not.toBe('');
      expect(messages.zh[key].trim(), key).not.toBe('');
      expect(fields(messages.zh[key]), key).toEqual(fields(messages.en[key]));
    }
  });

  it('follows Obsidian for Chinese locales and falls back to English', () => {
    for (const locale of ['zh', 'zh-CN', 'zh-TW', 'zh_HK', 'ZH-cn']) expect(resolveLanguage('auto', locale)).toBe('zh');
    for (const locale of ['en', 'en-GB', 'ja', 'fr', '', 'zho']) expect(resolveLanguage('auto', locale)).toBe('en');
    expect(resolveLanguage('auto')).toBe('en');
    expect(resolveLanguage('en', 'zh-CN')).toBe('en');
    expect(resolveLanguage('zh', 'en')).toBe('zh');
  });

  it('interpolates values without translating or reprocessing user content', () => {
    configureLanguage('en');
    expect(t('syncedExcerpts', { count: 4 })).toBe('Synced 4 excerpts');
    expect(t('cannotOpenBook', { error: '原文 {count} $& <tag>' })).toBe('Unable to open this book\n原文 {count} $& <tag>');
    configureLanguage('zh');
    expect(t('syncedExcerpts', { count: 0 })).toBe('已同步 0 条摘录');
    expect(t('syncedExcerpts')).toBe('已同步 {count} 条摘录');
  });

  it('uses the English entry if a translation is missing', () => {
    configureLanguage('zh');
    const original = messages.zh.retry;
    try { messages.zh.retry = ''; expect(t('retry')).toBe('Retry'); }
    finally { messages.zh.retry = original; }
  });

  it('notifies live views once per effective language change and permits cleanup', () => {
    configureLanguage('en');
    const update = vi.fn();
    const stop = onLanguageChange(update);
    configureLanguage('auto', 'zh-CN');
    expect(resolvedLanguage()).toBe('zh');
    expect(update).toHaveBeenCalledTimes(1);
    configureLanguage('zh', 'en');
    expect(update).toHaveBeenCalledTimes(1);
    stop();
    configureLanguage('en');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['文件路径无效，请选择库内文件。', 'errorPath'],
    ['无法读取 私有目录/book.epub.leafmark.json；原文件已保留，请检查数据。Unexpected token at byte 3', 'errorBookData'],
    ['找不到画布：私人/笔记.canvas。请重新选择文件。', 'errorMissingCanvas'],
    ['数据路径被文件夹占用：私人/笔记', 'errorDataFolder'],
    ['电子书不能请求外部资源。', 'errorExternalResource'],
    ['这本书采用固定版式；当前阅读器支持可重排的 EPUB，请使用可重排版本。', 'errorFixedLayout'],
    ['画布数据无法安全读取，原文件已保留。节点格式无效或标识重复', 'errorCanvasData'],
    ['此画布在多个窗格中打开。请保留一个画布窗格后重试，以免覆盖其他窗格的编辑。', 'errorMultiplePanes'],
    ['无法保存画布备份，未同步摘录。disk full /private/internal/path', 'errorBackupFailed'],
  ] as const)('maps known safety errors to the current language: %s', (message, key) => {
    configureLanguage('en');
    expect(friendlyError(new Error(message))).toBe(t(key));
    expect(friendlyError(new Error(message))).not.toMatch(/[\u3400-\u9fff]/);
    configureLanguage('zh');
    expect(friendlyError(new Error(message))).toBe(t(key));
  });

  it('relocalizes already-translated app errors and hides unknown implementation details', () => {
    configureLanguage('zh');
    const error = new Error(t('errorWrongVault'));
    configureLanguage('en');
    expect(friendlyError(error)).toBe(t('errorWrongVault'));
    expect(friendlyError(new Error('TypeError: getSomething is undefined at /secret/file.ts'))).toBe(t('errorUnknown'));
  });
});
