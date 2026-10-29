import wechatQr from '../assets/weixinpay.png';
import alipayQr from '../assets/alipay.jpg';
import { Plugin, TFile, FuzzySuggestModal, Notice, PluginSettingTab, Setting, Modal, getLanguage, type SettingDefinitionItem } from 'obsidian';
import { LeafmarkStore } from './store';
import { CanvasService } from './canvas';
import { vaultPath, isCfi } from './model';
import { ReaderView, READER_VIEW } from './reader';
import { configureLanguage, friendlyError, onLanguageChange, t, type LanguagePreference } from './i18n';

export interface Preferences { fontSize:number; lineHeight:number; theme:'system'|'light'|'dark'; language:LanguagePreference }
const DEFAULTS: Preferences = {fontSize:18,lineHeight:1.85,theme:'system',language:'auto'};
class FilePicker extends FuzzySuggestModal<TFile> {
  constructor(private plugin: LeafmarkPlugin, private extension:string, private choose:(file:TFile)=>Promise<void>) {
    super(plugin.app); this.updateLanguage();
  }
  private stopLanguage?:()=>void;
  private updateLanguage(){this.setPlaceholder(t(this.extension==='epub'?'pickBook':'pickCanvas'));this.emptyStateText=t(this.extension==='epub'?'noBooks':'noCanvases');}
  onOpen(){void super.onOpen();this.stopLanguage=onLanguageChange(()=>this.updateLanguage());}
  onClose(){this.stopLanguage?.();super.onClose();}
  getItems() { return this.app.vault.getFiles().filter(f=>f.extension.toLowerCase()===this.extension); }
  getItemText(file:TFile) { return file.path; }
  onChooseItem(file:TFile) { void this.choose(file).catch(e=>this.plugin.notify(e)); }
}
export default class LeafmarkPlugin extends Plugin {
  store!:LeafmarkStore;
  canvas!:CanvasService;
  preferences:Preferences={...DEFAULTS};
  async onload() {
    const raw=await this.loadData() as Partial<Preferences>|null;
    this.preferences={...DEFAULTS,...raw};
    this.preferences.fontSize=Math.min(30,Math.max(14,Number(this.preferences.fontSize)||18));
    this.preferences.lineHeight=Math.min(2.3,Math.max(1.5,Number(this.preferences.lineHeight)||1.85));
    if(!['system','light','dark'].includes(this.preferences.theme))this.preferences.theme='system';
    if(!['auto','zh','en'].includes(this.preferences.language))this.preferences.language='auto';
    configureLanguage(this.preferences.language,getLanguage());
    this.store=new LeafmarkStore(this.app.vault); this.canvas=new CanvasService(this.app);
    this.registerView(READER_VIEW,leaf=>new ReaderView(leaf,this));
    // A different EPUB plugin may already own the extension. Our explicit command still works.
    try { this.registerExtensions(['epub'],READER_VIEW); } catch { /* Keep other reader registrations intact. */ }
    const openCommand=this.addCommand({id:'open-book',name:t('openBook'),callback:()=>this.pickBook()});
    const ribbon=this.addRibbonIcon('book-open',t('ribbonOpenBook'),()=>this.pickBook());
    this.register(onLanguageChange(()=>{openCommand.name=t('openBook');ribbon.setAttribute('aria-label',t('ribbonOpenBook'));ribbon.title=t('ribbonOpenBook');}));
    this.registerObsidianProtocolHandler('leafmark',params=>{
      void(async()=>{
        if(params.vault && params.vault!==this.app.vault.getName()) throw new Error(t('errorWrongVault'));
        const path=vaultPath(params.book??'');
        const state=await this.store.loadBook(path);
        const annotation=state.annotations.find(a=>a.id===params.annotation);
        const cfi=annotation?.cfiRange ?? (isCfi(params.cfi)?params.cfi:undefined);
        if(!cfi) throw new Error(t('errorMissingLocation'));
        await this.openBook(path,cfi);
      })().catch(e=>this.notify(e));
    });
    this.addSettingTab(new ReaderSettings(this));
  }
  notify(error:unknown) { new Notice(friendlyError(error),8000); }
  pickBook() { new FilePicker(this,'epub',file=>this.openBook(file.path)).open(); }
  pickCanvas(choose:(file:TFile)=>Promise<void>) { new FilePicker(this,'canvas',choose).open(); }
  async openBook(path:string,cfi?:string) {
    const file=this.app.vault.getFileByPath(vaultPath(path));
    if(!file||file.extension!=='epub')throw new Error(t('errorMissingBook'));
    let leaf=this.app.workspace.getLeavesOfType(READER_VIEW).find(l=>l.getViewState().state?.file===file.path);
    if(!leaf) {
      leaf=this.app.workspace.getActiveFile()?.extension==='canvas'?this.app.workspace.getLeaf('split','vertical'):this.app.workspace.getLeaf('tab');
      await leaf.setViewState({type:READER_VIEW,state:{file:file.path},active:true});
    }
    await leaf.loadIfDeferred(); await this.app.workspace.revealLeaf(leaf);
    if(cfi && leaf.view instanceof ReaderView) await leaf.view.goTo(cfi);
  }
  async savePreferences() {
    await this.saveData(this.preferences);
    configureLanguage(this.preferences.language,getLanguage());
    for(const leaf of this.app.workspace.getLeavesOfType(READER_VIEW)) if(leaf.view instanceof ReaderView)leaf.view.updateAppearance();
  }

}
class ReaderSettings extends PluginSettingTab {
  constructor(private plugin:LeafmarkPlugin){super(plugin.app,plugin);}
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {name:t('language'),desc:t('languageDescription'),render:setting=>{setting.addDropdown(c=>c.addOptions({auto:t('followObsidian'),zh:'中文',en:'English'}).setValue(this.plugin.preferences.language).onChange(async v=>{this.plugin.preferences.language=v as LanguagePreference;await this.plugin.savePreferences();this.update();}));}},
      {name:t('fontSize'),render:setting=>{setting.addSlider(c=>c.setLimits(14,30,1).setValue(this.plugin.preferences.fontSize).onChange(async v=>{this.plugin.preferences.fontSize=v;await this.plugin.savePreferences();}));}},
      {name:t('readingAppearance'),render:setting=>{setting.addDropdown(c=>c.addOptions({system:t('followObsidian'),light:t('light'),dark:t('dark')}).setValue(this.plugin.preferences.theme).onChange(async v=>{this.plugin.preferences.theme=v as Preferences['theme'];await this.plugin.savePreferences();}));}},
      {name:t('supportDevelopment'),desc:t('supportInlineDescription'),render:setting=>{setting.setHeading();setting.settingEl.addClass('lm-support-section');this.renderSupport(setting.settingEl);}},
    ];
  }
  private renderSupport(container:HTMLElement){
    const codes=container.createDiv({cls:'lm-support-codes'});
    for(const [label,url] of [[t('wechatPay'),wechatQr],[t('alipay'),alipayQr]]){
      const card=codes.createDiv({cls:'lm-support-card'});new Setting(card).setName(label).setHeading();
      const button=card.createEl('button',{cls:'lm-support-code',attr:{type:'button','aria-label':t('enlargeQr',{name:label})}});
      button.createEl('img',{attr:{src:url,alt:label}});
      button.addEventListener('click',()=>new SupportCodeModal(this.plugin,label,url).open());
    }
    container.createEl('p',{cls:'setting-item-description',text:t('supportVerify')});
  }
}

class SupportCodeModal extends Modal {
  constructor(plugin:LeafmarkPlugin,private label:string,private url:string){super(plugin.app);}
  onOpen(){this.contentEl.addClass('lm-support-modal');new Setting(this.contentEl).setName(this.label).setHeading();this.contentEl.createEl('img',{attr:{src:this.url,alt:this.label}});}
  onClose(){this.contentEl.empty();}
}
