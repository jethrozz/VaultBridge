import { App, Modal, Setting } from 'obsidian';

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
