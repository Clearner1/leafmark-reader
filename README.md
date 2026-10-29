# Leafmark Reader

[中文](#中文) · [Support](SUPPORT.md)

Read local EPUB books in Obsidian, highlight a passage or write a thought, and collect source-linked excerpts on native Canvas.

- English and Chinese interface; follows Obsidian or switches manually.
- Reflowable EPUB reading, contents, typography and saved position.
- Highlights and thoughts stored beside the book in a readable `.leafmark.json` file.
- Canvas excerpt cards with links to exact book passages and reverse navigation.
- Existing Canvas edits preserved; backup before first write.
- Optional import of supported earlier Markdown excerpts, with explicit warnings for unsupported data.

## Install

Download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/Clearner1/leafmark-reader/releases). Place them in `<vault>/.obsidian/plugins/leafmark-reader/`, reload Community plugins, and enable Leafmark Reader. Run **Leafmark Reader: Open EPUB**. Connect a Canvas, then select text to highlight or write a thought.

The official Obsidian directory submission is pending; this README does not claim approval.

## Scope and data

Initial desktop release, tested on macOS. Fixed-layout EPUBs are rejected with an explanation. Mobile and Windows host testing is not yet complete. Do not enable multiple plugins as the default EPUB reader simultaneously; the explicit Open EPUB command remains available if another reader owns the extension.

Deleting an annotation retains its Canvas card and source link. Renaming/moving books and multi-device concurrent editing need further validation. No telemetry, account, paid service, or external book upload. Book scripts and external resources are blocked. Opening the project/support link uses the browser. Clipboard is not required for the core workflow.

## Development

`npm ci` → `npm run check` → `npm test` → `npm run build`.

Independently implemented plugin integration using public EPUB.js, Obsidian APIs and JSON Canvas documentation. EPUB.js and other general-purpose dependencies retain their licenses in THIRD_PARTY_NOTICES.md. Native Canvas focus relies on guarded host interfaces and may need updates as Obsidian changes. No EPUB Marginalia or Weave plugin source is included. Compatibility import reads user-owned exported data.

## 中文

在 Obsidian 里阅读 EPUB，划线或写想法，自动生成白板摘录卡片，并能在卡片与原文之间跳转。

设置支持“跟随 Obsidian / 中文 / English”。通过命令面板打开 EPUB，连接白板后即可使用。摘录保存在书籍旁的 `.leafmark.json` 文件中；书籍原文不修改。当前为桌面早期版本，移动端和 Windows 尚未完成实机验证，官方插件目录尚未批准上架。

[下载版本](https://github.com/Clearner1/leafmark-reader/releases) · [问题反馈](https://github.com/Clearner1/leafmark-reader/issues) · [项目支持](SUPPORT.md)

## Support development / 支持开发

All features remain free. If Leafmark helps you, voluntary support funds continued maintenance. Payment codes are also available directly in the plugin settings, with click-to-enlarge.

所有功能免费使用。如果 Leafmark 对你的阅读有帮助，欢迎自愿打赏。插件设置内也可直接查看、点击放大收款码。

| WeChat Pay / 微信支付 | Alipay / 支付宝 |
| --- | --- |
| <img src="https://raw.githubusercontent.com/Clearner1/leafmark-reader/main/assets/weixinpay.png" width="240" alt="WeChat Pay"> | <img src="https://raw.githubusercontent.com/Clearner1/leafmark-reader/main/assets/alipay.jpg" width="240" alt="Alipay"> |

### Build security

The build removes EPUB.js script-loading methods (`Contents.addScript` and `Rendition.injectScript`); scripted EPUB content is not supported. JSZip and localForage are bundled from source instead of their legacy browser distributions. Node stream support uses the desktop host’s built-in module. Legacy scheduling polyfills are replaced with function-only browser scheduling, without dynamic code execution. XML parsing uses a patched `@xmldom/xmldom` release. Run `npm run lint`, `npm run check`, `npm test`, and `npm run build` before publishing.
