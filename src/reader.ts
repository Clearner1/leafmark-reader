import { compactRange } from './migrate';
import { chooseLegacyExcerpts } from './migration-ui';
import { FileView, TFile, WorkspaceLeaf, Menu, Modal, setIcon } from 'obsidian';
import type LeafmarkPlugin from './main';
import { EpubEngine, type ReaderSelection, type ChapterEntry } from './engine';
import type { Annotation, BookState } from './model';
import { friendlyError, onLanguageChange, t, type TranslationKey } from './i18n';

export const READER_VIEW='leafmark-reading';
type Panel='chapters'|'excerpts'|'settings';
type Filter='all'|'highlights'|'thoughts';
type BookOrigin={bookPath:string;generation:number;canvasPath:string|null};

export class ReaderView extends FileView {
  private engine?:EpubEngine;
  private pendingCfi?:string;
  private bookLoaded=false;
  private statusMessage:()=>string=()=>t('startReading');
  private loadingError?:unknown;
  private menu?:Menu;
  private state?:BookState;
  private title!:HTMLElement;
  private chapter!:HTMLElement;
  private status!:HTMLElement;
  private retry!:HTMLButtonElement;
  private canvasButton!:HTMLButtonElement;
  private panel!:HTMLElement;
  private panelContent!:HTMLElement;
  private reader!:HTMLElement;
  private mountEl!:HTMLElement;
  private panelMode:Panel='chapters';
  private filter:Filter='all';
  private query='';
  private floating?:HTMLElement;
  private pendingSelection?:ReaderSelection;
  private retryAction?:()=>Promise<void>;
  private generation=0;
  private ready:Promise<void>=Promise.resolve();
  private busy=false;
  private positionTimer?:number;
  private position?:string;
  private positionBookPath?:string;
  private lastAnnotation?:Annotation;
  constructor(leaf:WorkspaceLeaf,private plugin:LeafmarkPlugin){super(leaf);}
  getViewType(){return READER_VIEW;}
  getDisplayText(){return this.file?.basename??t('readerName');}
  getIcon(){return 'book-open';}
  setEphemeralState(state:Record<string,unknown>){
    super.setEphemeralState(state);
    const subpath=typeof state.subpath==='string'?state.subpath:'';
    if(!subpath.includes('cfi='))return;
    try{
      const params=new URLSearchParams(subpath.replace(/^#/,''));
      const start=params.get('cfi');const end=params.get('end');if(!start)return;
      const cfi=end?compactRange(start,end):(start.startsWith('epubcfi(')?start:`epubcfi(${start})`);
      this.pendingCfi=cfi;
      if(this.bookLoaded){const origin=this.origin();const engine=this.engine;this.run(async()=>{await engine?.goToCFI(cfi);if(origin&&this.isCurrent(origin)&&this.pendingCfi===cfi)this.pendingCfi=undefined;});}
    }catch(e){this.fail(e);}
  }
  async onOpen(){
    this.contentEl.addClass('lm-view');this.build();
    this.register(onLanguageChange(()=>this.updateLanguage()));
    this.registerEvent(this.app.workspace.on('css-change',()=>this.updateAppearance()));
    this.registerDomEvent(this.contentEl.ownerDocument,'keydown',e=>{if(e.key==='Escape')this.dismissTools();});
    this.registerDomEvent(this.contentEl.ownerDocument,'pointerdown',e=>{
      if(this.floating && !this.floating.contains(e.target as Node))this.dismissTools();
    });
    this.registerEvent(this.app.vault.on('modify',file=>{
      if(this.file && file.path===this.plugin.store.sidecarPath(this.file.path))this.run(async()=>{await this.refreshState();});
    }));
  }
  private button(parent:HTMLElement,label:string,action:()=>void,icon?:string,primary=false){
    const btn=parent.createEl('button',{cls:icon?'lm-icon-button':'lm-button',attr:{type:'button','aria-label':label,title:label}});
    if(icon)setIcon(btn,icon);else btn.textContent=label;
    if(primary)btn.addClass('lm-primary');
    btn.addEventListener('click',action);return btn;
  }
  private uiButton(parent:HTMLElement,key:TranslationKey,action:()=>void,icon?:string,primary=false){
    const button=this.button(parent,t(key),action,icon,primary);button.dataset.i18n=key;if(icon)button.dataset.i18nIcon='true';return button;
  }
  updateLanguage(){
    this.dismissTools();this.menu?.hide();
    this.contentEl.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el=>{const label=t(el.dataset.i18n as TranslationKey);el.setAttribute('aria-label',label);el.title=label;if(!el.dataset.i18nIcon)el.textContent=label;});
    this.panel?.querySelector('[role=tablist]')?.setAttribute('aria-label',t('readingNavigation'));
    if(!this.file)this.title.textContent=t('openABook');
    if(this.status)this.status.textContent=this.statusMessage();
    const loading=this.reader?.querySelector<HTMLElement>('.lm-state');
    if(loading)loading.textContent=loading.hasClass('lm-error')?t('cannotOpenBook',{error:friendlyError(this.loadingError)}):t('opening');
    this.updateCanvasLabel();this.renderPanel();
  }
  private updateCanvasLabel(){
    if(!this.canvasButton)return;
    const key=this.state?.canvasPath?'canvas':'connectCanvas';
    this.canvasButton.dataset.i18n=key;this.canvasButton.textContent=t(key);this.canvasButton.setAttribute('aria-label',t(key));this.canvasButton.title=this.state?.canvasPath??t('pickCanvas');
  }
  private origin():BookOrigin|undefined{
    const bookPath=this.file?.path;if(!bookPath)return;
    return {bookPath,generation:this.generation,canvasPath:this.state?.bookPath===bookPath?this.state.canvasPath:null};
  }
  private isCurrent(origin:BookOrigin){return origin.generation===this.generation&&origin.bookPath===this.file?.path;}
  private run(task:()=>Promise<void>){
    const generation=this.generation;const bookPath=this.file?.path;
    void task().catch(e=>{if(generation===this.generation&&bookPath===this.file?.path)this.fail(e,task);});
  }
  private build(){
    this.contentEl.empty();
    const bar=this.contentEl.createDiv({cls:'lm-toolbar'});
    this.uiButton(bar,'chaptersAndExcerpts',()=>{this.panel.hidden=!this.panel.hidden;this.renderPanel();this.engine?.resize();},'panel-left');
    const heading=bar.createDiv({cls:'lm-title-block'});
    this.title=heading.createDiv({cls:'lm-book-title',text:this.file?.basename??t('openABook')});
    this.chapter=heading.createDiv({cls:'lm-chapter-title'});
    this.canvasButton=this.uiButton(bar,'connectCanvas',()=>this.openCanvas());this.canvasButton.addClass('lm-canvas-link');
    this.uiButton(bar,'readingOptions',()=>this.openMenu(),'ellipsis');
    const nav=bar.createDiv({cls:'lm-nav-group'});
    this.uiButton(nav,'previousSection',()=>this.run(async()=>{this.dismissTools();await this.engine?.previous();}),'chevron-left');
    this.uiButton(nav,'nextSection',()=>this.run(async()=>{this.dismissTools();await this.engine?.next();}),'chevron-right');
    const body=this.contentEl.createDiv({cls:'lm-body'});
    this.panel=body.createEl('aside',{cls:'lm-panel'});this.panel.hidden=true;
    const tabs=this.panel.createDiv({cls:'lm-panel-tabs',attr:{role:'tablist','aria-label':t('readingNavigation')}});
    for(const [mode,label] of [['chapters','chapters'],['excerpts','excerpts'],['settings','typography']] as const){
      const b=this.uiButton(tabs,label,()=>{this.panelMode=mode;this.renderPanel();});b.addClass('lm-tab');b.dataset.mode=mode;b.setAttribute('role','tab');
    }
    this.panelContent=this.panel.createDiv({cls:'lm-panel-content'});
    this.reader=body.createDiv({cls:'lm-reader'});
    this.mountEl=this.reader.createDiv({cls:'lm-engine'});
    const footer=this.contentEl.createDiv({cls:'lm-statusbar'});
    this.status=footer.createSpan({cls:'lm-status',attr:{role:'status','aria-live':'polite'},text:t('startReading')});
    this.retry=this.uiButton(footer,'retry',()=>{if(this.retryAction)this.run(this.retryAction);});this.retry.addClass('lm-retry');this.retry.hidden=true;
  }
  async onLoadFile(file:TFile){this.ready=this.loadBookFile(file);await this.ready;}
  private async loadBookFile(file:TFile){
    const generation=++this.generation;this.bookLoaded=false;this.busy=false;this.state=undefined;this.dismissTools();this.menu?.hide();this.engine?.destroy();
    if(this.positionTimer)window.clearTimeout(this.positionTimer);this.positionTimer=undefined;this.position=undefined;this.positionBookPath=file.path;
    if(!this.mountEl)this.build();this.title.textContent=file.basename;this.title.title=file.basename;
    this.mountEl.empty();this.loadingError=undefined;this.setStatus(()=>t('openingBook'));
    const loading=this.reader.createDiv({cls:'lm-state',text:t('opening')});
    const engine=new EpubEngine(this.mountEl,{
      onSelection:s=>{if(generation===this.generation)this.showSelection(s);},
      onHighlightClick:id=>{if(generation===this.generation)void this.showAnnotation(id);},
      onLocation:l=>{if(generation!==this.generation)return;this.chapter.textContent=l.chapter;this.position=l.cfi;this.schedulePositionSave(file.path);},
      onError:e=>{if(generation===this.generation)this.fail(e,()=>this.loadBookFile(file));},
    });this.engine=engine;
    try{
      const state=await this.plugin.store.loadBook(file.path);
      const data=await this.app.vault.readBinary(file);
      if(generation!==this.generation)return;
      this.state=state;this.position=state.position?.cfi;this.updateAppearance();
      await engine.mount(data,this.pendingCfi??state.position?.cfi);
      if(generation!==this.generation)return;
      this.bookLoaded=true;if(this.pendingCfi){const cfi=this.pendingCfi;await engine.goToCFI(cfi);if(generation!==this.generation)return;if(this.pendingCfi===cfi)this.pendingCfi=undefined;}
      const origin={bookPath:file.path,generation,canvasPath:state.canvasPath};
      await this.refreshState(origin);if(!this.isCurrent(origin))return;this.setStatus(()=>t(state.canvasPath?'canvasConnected':'noCanvas'));
      this.renderPanel();
    }catch(e){if(generation===this.generation){this.fail(e,()=>this.loadBookFile(file));this.loadingError=e;loading.textContent=t('cannotOpenBook',{error:friendlyError(e)});loading.addClass('lm-error');return;}}
    finally{if(generation!==this.generation||!loading.hasClass('lm-error'))loading.remove();}
  }
  updateAppearance(){
    const p=this.plugin.preferences;
    const theme=p.theme==='system'?(this.contentEl.ownerDocument.body.hasClass('theme-dark')?'dark':'light'):p.theme;
    this.contentEl.dataset.theme=theme;
    this.engine?.setAppearance({fontSize:p.fontSize,lineHeight:p.lineHeight,theme,fontFamily:'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'});
  }
  private schedulePositionSave(bookPath:string){
    if(this.positionTimer)window.clearTimeout(this.positionTimer);
    const cfi=this.position;const generation=this.generation;if(!cfi)return;
    this.positionTimer=window.setTimeout(()=>{
      this.positionTimer=undefined;
      void this.plugin.store.savePosition(bookPath,cfi).catch(e=>{if(generation===this.generation&&bookPath===this.file?.path)this.fail(e,()=>this.plugin.store.savePosition(bookPath,cfi));});
    },600);
  }
  async onUnloadFile(file:TFile){
    const cfi=this.positionBookPath===file.path?this.position:undefined;
    ++this.generation;this.bookLoaded=false;this.busy=false;this.dismissTools();this.menu?.hide();if(this.positionTimer)window.clearTimeout(this.positionTimer);
    this.positionTimer=undefined;this.position=undefined;this.positionBookPath=undefined;this.pendingCfi=undefined;
    this.engine?.destroy();this.engine=undefined;this.state=undefined;
    if(cfi)await this.plugin.store.savePosition(file.path,cfi).catch(e=>this.plugin.notify(e));
  }
  async onClose(){++this.generation;this.bookLoaded=false;this.busy=false;this.dismissTools();this.menu?.hide();if(this.positionTimer)window.clearTimeout(this.positionTimer);this.positionTimer=undefined;this.engine?.destroy();this.engine=undefined;}
  async goTo(cfi:string){
    const origin=this.origin();const ready=this.ready;await ready;if(!origin||!this.isCurrent(origin))return;
    this.dismissTools();if(!this.engine)throw new Error(t('errorBookNotOpen'));await this.engine.goToCFI(cfi);
  }
  private setStatus(text:()=>string){this.statusMessage=text;this.status.textContent=text();this.status.removeClass('is-error');this.retry.hidden=true;this.retryAction=undefined;}
  private fail(error:unknown,retry?:()=>Promise<void>){this.statusMessage=typeof error==='function'?error as ()=>string:()=>friendlyError(error);this.status.textContent=this.statusMessage();this.status.addClass('is-error');this.retryAction=retry;this.retry.hidden=!retry;}
  private async refreshState(origin=this.origin()){
    if(!origin)return;
    const state=await this.plugin.store.loadBook(origin.bookPath);if(!this.isCurrent(origin))return state;
    this.state=state;this.engine?.setHighlights(state.annotations.map(a=>({id:a.id,cfi:a.cfiRange,color:a.color,thought:a.thought})));
    this.updateCanvasLabel();
    if(!this.panel.hidden && this.panelMode==='excerpts')this.renderPanel();
    return state;
  }
  private openCanvas(){
    const origin=this.origin();if(!origin)return;
    if(origin.canvasPath)this.run(()=>this.plugin.canvas.openCanvas(origin.canvasPath!).then(()=>{}));
    else this.chooseCanvas(origin);
  }
  private chooseCanvas(origin=this.origin()){
    if(!origin)return;
    this.plugin.pickCanvas(async file=>{
      const target={...origin,canvasPath:file.path};
      await this.plugin.store.bindCanvas(origin.bookPath,file.path);
      await this.syncAll(target);if(this.isCurrent(origin))await this.plugin.canvas.openCanvas(file.path);
    });
  }
  private async createCanvas(){
    const book=this.file;const origin=this.origin();if(!book||!origin)return;
    const folder=book.parent?.path;const base=`${folder?folder+'/':''}${book.basename} ${t('canvasFileSuffix')}`;
    let path=base+'.canvas';let n=2;while(this.app.vault.getAbstractFileByPath(path))path=`${base} ${n++}.canvas`;
    const file=await this.app.vault.create(path,JSON.stringify({nodes:[],edges:[]}));
    await this.plugin.store.bindCanvas(origin.bookPath,file.path);
    await this.syncAll({...origin,canvasPath:file.path});if(this.isCurrent(origin))await this.plugin.canvas.openCanvas(file.path);
  }
  private async syncAll(origin=this.origin()){
    if(!origin)return;
    const state=await this.refreshState(origin);if(!state)return;
    const canvasPath=origin.canvasPath;
    if(!canvasPath){if(this.isCurrent(origin))this.chooseCanvas(origin);return;}
    if(this.isCurrent(origin))this.setStatus(()=>t('syncingCanvas'));
    for(const ann of state.annotations)await this.plugin.canvas.syncAnnotation(ann,canvasPath);
    if(this.isCurrent(origin)){const count=state.annotations.length;this.setStatus(()=>t('syncedExcerpts',{count}));}
  }
  private openMenu(){
    const menu=new Menu();this.menu=menu;
    menu.addItem(i=>i.setTitle(t('openAnotherBook')).setIcon('book-open').onClick(()=>this.plugin.pickBook()));
    menu.addItem(i=>i.setTitle(t('chooseExcerptCanvas')).setIcon('link').onClick(()=>this.chooseCanvas()));
    menu.addItem(i=>i.setTitle(t('createBookCanvas')).setIcon('layout-dashboard').onClick(()=>this.run(()=>this.createCanvas())));
    menu.addItem(i=>i.setTitle(t('resyncExcerpts')).setIcon('refresh-cw').onClick(()=>this.run(()=>this.syncAll())));
    menu.addItem(i=>i.setTitle(t('legacyImport')).setIcon('file-input').onClick(()=>{if(this.file)chooseLegacyExcerpts(this.plugin,this.file);}));
    menu.addSeparator();
    menu.addItem(i=>i.setTitle(t('readingLayout')).setIcon('type').onClick(()=>{this.panel.hidden=false;this.panelMode='settings';this.renderPanel();}));
    const rect=this.canvasButton.getBoundingClientRect();menu.showAtPosition({x:rect.left,y:rect.bottom+8});
  }
  private dismissTools(){this.floating?.remove();this.floating=undefined;}
  private tools(rect:DOMRect,annotation=false){
    this.dismissTools();const tools=this.contentEl.ownerDocument.body.createDiv({cls:annotation?'lm-annotation-tools':'lm-selection-tools'});this.floating=tools;
    tools.addEventListener('pointerdown',e=>e.stopPropagation());
    tools.dataset.theme=this.contentEl.dataset.theme??'light';
    return {tools,place:()=>{
      const pane=this.reader.getBoundingClientRect();tools.style.maxWidth=`${Math.max(160,pane.width-24)}px`;
      const box=tools.getBoundingClientRect();let top=rect.bottom+10;
      if(top+box.height>pane.bottom-8)top=rect.top-box.height-10;
      tools.style.top=`${Math.max(pane.top+8,top)}px`;
      tools.style.left=`${Math.max(pane.left+8,Math.min(rect.left,pane.right-box.width-8))}px`;
    }};
  }
  private showSelection(selection:ReaderSelection){
    if(this.busy)return;this.pendingSelection=selection;
    const {tools,place}=this.tools(selection.rect);
    this.uiButton(tools,'highlight',()=>this.run(()=>this.saveSelection(selection)),undefined,true);
    this.uiButton(tools,'writeThought',()=>this.writeThought(selection));place();
  }
  private async saveSelection(selection:ReaderSelection,thought?:string,origin=this.origin()){
    if(!origin||(this.isCurrent(origin)&&this.busy))return;
    if(this.isCurrent(origin)){this.busy=true;this.setStatus(()=>t('saving'));}
    try{
      const state=await this.plugin.store.loadBook(origin.bookPath);
      let annotation=state.annotations.find(a=>a.cfiRange===selection.cfi);
      if(annotation && thought!==undefined)annotation=await this.plugin.store.updateAnnotation(origin.bookPath,annotation.id,{thought});
      if(!annotation)annotation=await this.plugin.store.addAnnotation(origin.bookPath,{cfiRange:selection.cfi,quote:selection.text,thought,chapter:selection.chapter,color:'yellow'});
      await this.refreshState(origin);
      if(this.isCurrent(origin)){this.lastAnnotation=annotation;this.engine?.clearSelection();this.dismissTools();}
      if(origin.canvasPath){
        try{await this.plugin.canvas.syncAnnotation(annotation,origin.canvasPath);if(this.isCurrent(origin))this.setStatus(()=>t('excerptAndCanvasSaved'));}
        catch(e){if(this.isCurrent(origin))this.fail(()=>t('excerptSavedCanvasFailed',{error:friendlyError(e)}),()=>this.syncAll(origin));}
      }else if(this.isCurrent(origin)){this.setStatus(()=>t('excerptSavedConnectCanvas'));}
    }catch(e){if(this.isCurrent(origin))this.fail(()=>t('saveFailed',{error:friendlyError(e)}),()=>this.saveSelection(selection,thought,origin));throw e;}
    finally{if(this.isCurrent(origin))this.busy=false;}
  }
  private writeThought(selection:ReaderSelection,annotation?:Annotation){
    const origin=this.origin();if(!origin||annotation&&annotation.bookPath!==origin.bookPath)return;
    this.dismissTools();
    new ThoughtDialog(this.plugin,selection.text,annotation?.thought??'',async text=>{
      if(annotation){
        const updated=await this.plugin.store.updateAnnotation(origin.bookPath,annotation.id,{thought:text});
        await this.refreshState(origin);
        if(origin.canvasPath)await this.plugin.canvas.syncAnnotation(updated,origin.canvasPath);
        if(this.isCurrent(origin))this.setStatus(()=>t('thoughtSaved'));
      }else await this.saveSelection(selection,text,origin);
    }).open();
  }
  private async showAnnotation(id:string){
    const origin=this.origin();const ann=this.state?.annotations.find(a=>a.id===id);if(!origin||!ann)return;
    const rect=await this.engine?.getRangeRect(ann.cfiRange);if(!rect||!this.isCurrent(origin))return;
    const {tools,place}=this.tools(rect,true);
    this.uiButton(tools,'viewInCanvas',()=>{this.dismissTools();this.run(async()=>{
      if(!origin.canvasPath){if(this.isCurrent(origin))this.chooseCanvas(origin);return;}
      await this.plugin.canvas.syncAnnotation(ann,origin.canvasPath);
      if(this.isCurrent(origin))await this.plugin.canvas.focusAnnotation(ann,origin.canvasPath);
    });},undefined,true);
    this.uiButton(tools,ann.thought?'editThought':'writeThought',()=>{if(this.isCurrent(origin))this.writeThought({cfi:ann.cfiRange,text:ann.quote,chapter:ann.chapter,rect},ann);});
    this.uiButton(tools,'removeHighlight',()=>{this.dismissTools();this.run(async()=>{
      await this.plugin.store.deleteAnnotation(origin.bookPath,ann.id);await this.refreshState(origin);
      if(this.isCurrent(origin))this.setStatus(()=>t('highlightRemoved'));
    });},'trash-2');place();
  }
  private renderPanel(){
    if(!this.panelContent)return;
    this.panel.querySelectorAll<HTMLButtonElement>('.lm-tab').forEach(t=>{const active=t.dataset.mode===this.panelMode;t.toggleClass('is-active',active);t.setAttribute('aria-selected',String(active));});
    this.panelContent.empty();
    if(this.panelMode==='chapters'){
      const render=(entries:ChapterEntry[],depth=0)=>{for(const entry of entries){const b=this.button(this.panelContent,entry.label,()=>this.run(async()=>{await this.engine?.goToChapter(entry.href);this.dismissTools();}));b.addClass('lm-chapter-row');b.style.setProperty('--lm-depth',String(depth));render(entry.subitems,depth+1);}};
      const chapters=this.engine?.getToc()??[];render(chapters);if(!chapters.length)this.panelContent.createDiv({cls:'lm-empty',text:t('noChapters')});return;
    }
    if(this.panelMode==='settings'){
      const setting=this.panelContent.createDiv({cls:'lm-setting'});const label=setting.createEl('label',{text:t('fontSize')});const output=label.createEl('output',{text:`${this.plugin.preferences.fontSize}px`});
      const input=setting.createEl('input',{type:'range',attr:{min:'14',max:'30',step:'1','aria-label':t('fontSize')}});input.value=String(this.plugin.preferences.fontSize);
      input.addEventListener('input',()=>{this.plugin.preferences.fontSize=Number(input.value);output.textContent=`${input.value}px`;this.updateAppearance();});input.addEventListener('change',()=>this.run(()=>this.plugin.savePreferences()));
      const theme=this.panelContent.createDiv({cls:'lm-setting'});theme.createEl('label',{text:t('appearance')});const select=theme.createEl('select',{attr:{'aria-label':t('readingAppearance')}});
      for(const [value,label] of [['system',t('followObsidian')],['light',t('light')],['dark',t('dark')]])select.createEl('option',{value,text:label});select.value=this.plugin.preferences.theme;
      select.addEventListener('change',()=>{this.plugin.preferences.theme=select.value as 'system'|'light'|'dark';this.run(()=>this.plugin.savePreferences());});return;
    }
    const search=this.panelContent.createEl('input',{type:'search',cls:'lm-search',attr:{placeholder:t('searchExcerpts'),'aria-label':t('searchExcerpts')}});search.value=this.query;
    const filters=this.panelContent.createDiv({cls:'lm-filter'});
    for(const [value,label] of [['all','all'],['highlights','highlights'],['thoughts','thoughts']] as const){const b=this.uiButton(filters,label,()=>{this.filter=value;this.renderPanel();});b.addClass('lm-filter-button');b.toggleClass('is-active',this.filter===value);b.setAttribute('aria-pressed',String(this.filter===value));}
    const list=this.panelContent.createDiv({cls:'lm-annotations'});
    const renderList=()=>{
      list.empty();const query=this.query.trim().toLowerCase();const annotations=(this.state?.annotations??[]).filter(a=>{const thought=Boolean(a.thought?.trim());return(this.filter==='all'||(this.filter==='thoughts'?thought:!thought))&&(!query||`${a.quote} ${a.thought??''} ${a.chapter}`.toLowerCase().includes(query));});
      if(!annotations.length){list.createDiv({cls:'lm-empty',text:t(this.state?.annotations.length?'noMatches':'noExcerpts')});return;}
      for(const ann of annotations){
        const row=list.createEl('article',{cls:'lm-annotation'});row.createDiv({cls:'lm-item-meta',text:ann.chapter||t('sourceText')});
        const quote=this.button(row,ann.quote,()=>this.run(()=>this.goTo(ann.cfiRange)));quote.addClass('lm-quote');
        if(ann.thought)row.createDiv({cls:'lm-thought',text:ann.thought});
        const actions=row.createDiv({cls:'lm-item-actions'});this.uiButton(actions,'backToSource',()=>this.run(()=>this.goTo(ann.cfiRange)),'arrow-up-right');
        this.uiButton(actions,'editThought',()=>this.writeThought({cfi:ann.cfiRange,text:ann.quote,chapter:ann.chapter,rect:row.getBoundingClientRect()},ann),'message-square');
      }
    };search.addEventListener('input',()=>{this.query=search.value;renderList();});renderList();
  }
}
class ThoughtDialog extends Modal {
  private stopLanguage?:()=>void;
  constructor(private plugin:LeafmarkPlugin,private quote:string,private initial:string,private save:(text:string)=>Promise<void>){super(plugin.app);}
  onOpen(){
    this.contentEl.addClass('lm-thought-dialog');const heading=this.contentEl.createEl('h2');
    this.contentEl.createEl('blockquote',{cls:'lm-quote',text:this.quote});
    const input=this.contentEl.createEl('textarea',{cls:'lm-thought-input',attr:{rows:'5'}});input.value=this.initial;
    const error=this.contentEl.createDiv({cls:'lm-error',attr:{role:'alert'}});let lastError:unknown;
    const actions=this.contentEl.createDiv({cls:'lm-dialog-actions'});const cancel=actions.createEl('button');cancel.addEventListener('click',()=>this.close());
    const submit=actions.createEl('button',{cls:'lm-button lm-primary'});
    const updateLanguage=()=>{heading.textContent=t('thoughtHeading');input.placeholder=t('thoughtPlaceholder');input.setAttribute('aria-label',t('thought'));cancel.textContent=t('cancel');submit.textContent=t('saveThought');if(lastError!==undefined)error.textContent=friendlyError(lastError);};
    updateLanguage();this.stopLanguage=onLanguageChange(updateLanguage);
    const save=async()=>{submit.disabled=true;lastError=undefined;error.textContent='';try{await this.save(input.value.trim());this.close();}catch(e){lastError=e;error.textContent=friendlyError(e);}finally{submit.disabled=false;}};
    submit.addEventListener('click',()=>void save());input.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();if(!submit.disabled)void save();}});input.focus();
  }
  onClose(){this.stopLanguage?.();this.contentEl.empty();}
}
