import { App, Modal, Setting } from 'obsidian';
import * as Diff from 'diff';
import { html } from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';

export class VaultSyncModal extends Modal {
    title: string;
    message: string;
    
    constructor(app: App, title: string, message: string) {
        super(app);
        this.title = title;
        this.message = message;
    }
  
    onOpen() {
        const { contentEl } = this;
        
        // 添加标题
        contentEl.createEl('h2', { text: this.title, cls: 'vault-bridge-modal-title' });
        
        // 添加消息内容
        contentEl.createEl('div', { 
            text: this.message,
            cls: 'vault-bridge-modal-content'
        });
        
        // 添加确认按钮
        new Setting(contentEl)
            .addButton((btn) => {
                btn.setButtonText('确认')
                    .setCta()
                    .onClick(() => this.close());
            });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class ConfirmationModal extends Modal {
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
    
    constructor(app: App, title: string, message: string, onConfirm: () => void, onCancel?: () => void) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
    }
  
    onOpen() {
        const { contentEl } = this;
        
        // 添加标题
        contentEl.createEl('h2', { text: this.title, cls: 'vault-bridge-modal-title' });
        
        // 添加消息内容
        contentEl.createEl('div', { 
            text: this.message,
            cls: 'vault-bridge-modal-content'
        });
        
        // 添加按钮组
        const buttonContainer = contentEl.createDiv('vault-bridge-button-container');
        
        // 确认按钮
        const confirmButton = buttonContainer.createEl('button', {
            text: '确认',
            cls: 'vault-bridge-button vault-bridge-confirm-button'
        });
        confirmButton.addEventListener('click', () => {
            this.onConfirm();
            this.close();
        });
        
        // 取消按钮
        if (this.onCancel) {
            const cancelButton = buttonContainer.createEl('button', {
                text: '取消',
                cls: 'vault-bridge-button vault-bridge-cancel-button'
            });
            cancelButton.addEventListener('click', () => {
                if (this.onCancel) this.onCancel();
                this.close();
            });
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class ProgressModal extends Modal {
    title: string;
    message: string;
    progress: number;
    progressBar: HTMLDivElement;
    progressText: HTMLDivElement;
    messageEl: HTMLDivElement;
    
    constructor(app: App, title: string, initialMessage: string = '') {
        super(app);
        this.title = title;
        this.message = initialMessage;
        this.progress = 0;
    }
  
    onOpen() {
        const { contentEl } = this;
        
        // 添加标题
        contentEl.createEl('h2', { 
            text: this.title, 
            cls: 'vault-bridge-modal-title' 
        });
        
        // 添加进度条容器
        const progressContainer = contentEl.createDiv('vault-bridge-progress-container');
        
        // 添加进度条
        const progressBar = progressContainer.createDiv('vault-bridge-progress-bar');
        progressBar.style.width = `${this.progress}%`;
        
        // 添加进度文本
        const progressText = progressContainer.createDiv('vault-bridge-progress-text');
        progressText.textContent = `${this.progress}%`;
        
        // 添加消息内容
        const messageEl = contentEl.createDiv('vault-bridge-modal-content');
        messageEl.textContent = this.message;
        
        // 存储引用以便更新
        this.progressBar = progressBar;
        this.progressText = progressText;
        this.messageEl = messageEl;
    }
    
    updateProgress(progress: number) {
        this.progress = Math.min(100, Math.max(0, progress));
        if (this.progressBar && this.progressText) {
            this.progressBar.style.width = `${this.progress}%`;
            this.progressText.textContent = `${this.progress}%`;
        }
    }
    
    updateMessage(message: string) {
        this.message = message;
        if (this.messageEl) {
            this.messageEl.textContent = message;
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class DiffModal extends Modal {
    fileName: string;
    oldContent: string;
    newContent: string;
    onConfirm: (content?: string) => void;
    onCancel: () => void;
    isEditMode: boolean = false;
    diffContainer: HTMLDivElement;
    editContainer: HTMLDivElement;
    editTextarea: HTMLTextAreaElement;
    
    constructor(
        app: App, 
        fileName: string, 
        oldContent: string, 
        newContent: string, 
        onConfirm: (content?: string) => void, 
        onCancel: () => void
    ) {
        super(app);
        this.fileName = fileName;
        this.oldContent = oldContent;
        this.newContent = newContent;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
    }
  
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('vault-bridge-diff-modal');
        
        // 添加标题
        contentEl.createEl('h2', { 
            text: `文件差异: ${this.fileName}`, 
            cls: 'vault-bridge-modal-title' 
        });
        
        // 创建diff
        const diffPatch = Diff.createPatch(
            this.fileName,
            this.oldContent,
            this.newContent,
            '本地版本',
            '链上版本'
        );
        
        // 生成HTML diff视图
        const diffHtml = html(diffPatch, {
            drawFileList: false,
            matching: 'lines',
            outputFormat: 'side-by-side',
        });
        
        // 添加diff容器
        this.diffContainer = contentEl.createDiv('vault-bridge-diff-container');
        this.diffContainer.innerHTML = diffHtml;
        
        // 创建编辑容器（初始隐藏）
        this.editContainer = contentEl.createDiv('vault-bridge-edit-container');
        this.editContainer.style.display = 'none';
        
        // 创建编辑说明
        const editInfo = this.editContainer.createDiv('vault-bridge-edit-info');
        editInfo.createEl('p', { 
            text: '您可以手动编辑内容来解决冲突。编辑完成后点击"保存编辑"按钮。',
            cls: 'vault-bridge-edit-info-text'
        });
        
        // 创建文本编辑区
        this.editTextarea = this.editContainer.createEl('textarea', {
            cls: 'vault-bridge-edit-textarea'
        });
        this.editTextarea.value = this.oldContent; // 默认显示本地版本
        this.editTextarea.rows = 20;
        
        // 添加快速操作按钮
        const quickActionContainer = this.editContainer.createDiv('vault-bridge-quick-actions');
        
        const useLocalBtn = quickActionContainer.createEl('button', {
            text: '使用本地版本',
            cls: 'vault-bridge-quick-action-button'
        });
        useLocalBtn.addEventListener('click', () => {
            this.editTextarea.value = this.oldContent;
        });
        
        const useRemoteBtn = quickActionContainer.createEl('button', {
            text: '使用链上版本',
            cls: 'vault-bridge-quick-action-button'
        });
        useRemoteBtn.addEventListener('click', () => {
            this.editTextarea.value = this.newContent;
        });
        
        // 添加说明
        const infoEl = contentEl.createDiv('vault-bridge-diff-info');
        infoEl.createEl('p', { 
            text: '左侧为本地版本，右侧为链上版本。',
            cls: 'vault-bridge-diff-info-text'
        });
        
        // 添加按钮组
        const buttonContainer = contentEl.createDiv('vault-bridge-button-container');
        
        // 使用链上版本按钮
        const updateButton = buttonContainer.createEl('button', {
            text: '使用链上版本',
            cls: 'vault-bridge-button vault-bridge-confirm-button'
        });
        updateButton.addEventListener('click', () => {
            this.onConfirm(this.newContent);
            this.close();
        });
        
        // 使用本地版本按钮
        const keepLocalButton = buttonContainer.createEl('button', {
            text: '保持本地版本',
            cls: 'vault-bridge-button'
        });
        keepLocalButton.addEventListener('click', () => {
            this.onCancel();
            this.close();
        });
        
        // 手动编辑按钮
        const editButton = buttonContainer.createEl('button', {
            text: '手动编辑',
            cls: 'vault-bridge-button vault-bridge-edit-button'
        });
        editButton.addEventListener('click', () => {
            this.toggleEditMode();
        });
        
        // 保存编辑按钮（初始隐藏）
        const saveEditButton = buttonContainer.createEl('button', {
            text: '保存编辑',
            cls: 'vault-bridge-button vault-bridge-save-edit-button'
        });
        saveEditButton.style.display = 'none';
        saveEditButton.addEventListener('click', () => {
            const editedContent = this.editTextarea.value;
            this.onConfirm(editedContent);
            this.close();
        });
        
        // 取消编辑按钮（初始隐藏）
        const cancelEditButton = buttonContainer.createEl('button', {
            text: '取消编辑',
            cls: 'vault-bridge-button vault-bridge-cancel-button'
        });
        cancelEditButton.style.display = 'none';
        cancelEditButton.addEventListener('click', () => {
            this.toggleEditMode();
        });
        
        // 存储按钮引用以便切换显示
        (editButton as any).saveEditButton = saveEditButton;
        (editButton as any).cancelEditButton = cancelEditButton;
        (editButton as any).updateButton = updateButton;
        (editButton as any).keepLocalButton = keepLocalButton;
    }
    
    toggleEditMode() {
        this.isEditMode = !this.isEditMode;
        
        const editButton = this.contentEl.querySelector('.vault-bridge-edit-button') as HTMLButtonElement;
        const saveEditButton = (editButton as any).saveEditButton as HTMLButtonElement;
        const cancelEditButton = (editButton as any).cancelEditButton as HTMLButtonElement;
        const updateButton = (editButton as any).updateButton as HTMLButtonElement;
        const keepLocalButton = (editButton as any).keepLocalButton as HTMLButtonElement;
        
        if (this.isEditMode) {
            // 切换到编辑模式
            this.diffContainer.style.display = 'none';
            this.editContainer.style.display = 'block';
            editButton.style.display = 'none';
            updateButton.style.display = 'none';
            keepLocalButton.style.display = 'none';
            saveEditButton.style.display = 'inline-block';
            cancelEditButton.style.display = 'inline-block';
        } else {
            // 切换回diff视图模式
            this.diffContainer.style.display = 'block';
            this.editContainer.style.display = 'none';
            editButton.style.display = 'inline-block';
            updateButton.style.display = 'inline-block';
            keepLocalButton.style.display = 'inline-block';
            saveEditButton.style.display = 'none';
            cancelEditButton.style.display = 'none';
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
