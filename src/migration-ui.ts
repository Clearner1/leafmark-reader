import { FuzzySuggestModal, Modal, TFile } from 'obsidian';
import type LeafmarkPlugin from './main';
import { parseLegacyExcerpts } from './migrate';
import { t, friendlyError } from './i18n';

export function chooseLegacyExcerpts(plugin:LeafmarkPlugin,book:TFile){
  class Picker extends FuzzySuggestModal<TFile>{
    constructor(){super(plugin.app);this.setPlaceholder(t('legacyChoose'));}
    getItems(){return this.app.vault.getMarkdownFiles();}
    getItemText(file:TFile){return file.path;}
    onChooseItem(file:TFile){void plugin.app.vault.read(file).then(text=>{
      const result=parseLegacyExcerpts(text,book.path);
      new ImportDialog(plugin,book,result).open();
    }).catch(e=>plugin.notify(e));}
  }
  new Picker().open();
}
class ImportDialog extends Modal{
  constructor(private plugin:LeafmarkPlugin,private book:TFile,private result:ReturnType<typeof parseLegacyExcerpts>){super(plugin.app);}
  onOpen(){
    this.contentEl.addClass('lm-thought-dialog');this.contentEl.createEl('h2',{text:t('legacyImport')});
    this.contentEl.createEl('p',{text:t('legacySummary',{count:this.result.annotations.length})});
    if(this.result.warnings.length)this.contentEl.createEl('p',{text:t('legacyWarnings',{count:this.result.warnings.length}),cls:'lm-error'});
    const status=this.contentEl.createEl('p',{attr:{role:'status'}});
    const actions=this.contentEl.createDiv({cls:'lm-dialog-actions'});
    actions.createEl('button',{text:t('cancel')}).addEventListener('click',()=>this.close());
    const submit=actions.createEl('button',{cls:'lm-button lm-primary',text:t('legacyImport')});
    submit.disabled=!this.result.annotations.length||Boolean(this.result.warnings.length);
    submit.addEventListener('click',()=>{
      submit.disabled=true;status.textContent=t('saving');
      void(async()=>{
        let state=await this.plugin.store.loadBook(this.book.path);
        for(const input of this.result.annotations){
          let ann=state.annotations.find(a=>a.cfiRange===input.cfiRange);
          if(!ann)ann=await this.plugin.store.addAnnotation(this.book.path,input);
          if(state.canvasPath){
            const adopted=await this.plugin.canvas.adoptLegacyAnnotation(ann,state.canvasPath);
            if(!adopted)await this.plugin.canvas.syncAnnotation(ann,state.canvasPath);
          }
          state=await this.plugin.store.loadBook(this.book.path);
        }
        status.textContent=t('legacyDone');submit.hidden=true;
      })().catch(e=>{status.textContent=friendlyError(e);submit.disabled=false;});
    });
  }
  onClose(){this.contentEl.empty();}
}
