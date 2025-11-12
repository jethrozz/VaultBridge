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
    progressFill: HTMLDivElement;
    progressText: HTMLDivElement;
    messageEl: HTMLDivElement;
    statusIcon: HTMLSpanElement;
    spinnerEl: HTMLDivElement;
    stepsList: HTMLDivElement;
    steps: Array<{ text: string; status: 'pending' | 'processing' | 'completed' | 'error' }>;
    
    constructor(app: App, title: string, initialMessage: string = '') {
        super(app);
        this.title = title;
        this.message = initialMessage;
        this.progress = 0;
        this.steps = [];
    }
  
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('vault-bridge-progress-modal');
        
        // 添加头部区域
        const headerEl = contentEl.createDiv('vault-bridge-progress-header');
        
        // 添加状态图标和标题
        const titleContainer = headerEl.createDiv('vault-bridge-progress-title-container');
        this.statusIcon = titleContainer.createSpan('vault-bridge-status-icon');
        this.statusIcon.innerHTML = '⏳';
        
        titleContainer.createEl('h2', { 
            text: this.title, 
            cls: 'vault-bridge-modal-title vault-bridge-progress-title' 
        });
        
        // 添加旋转加载动画
        this.spinnerEl = headerEl.createDiv('vault-bridge-spinner');
        this.spinnerEl.innerHTML = `
            <div class="vault-bridge-spinner-circle"></div>
            <div class="vault-bridge-spinner-circle"></div>
            <div class="vault-bridge-spinner-circle"></div>
        `;
        
        // 添加进度条容器
        const progressContainer = contentEl.createDiv('vault-bridge-progress-container');
        
        // 进度条背景
        this.progressBar = progressContainer.createDiv('vault-bridge-progress-bar');
        
        // 进度条填充（带动画效果）
        this.progressFill = this.progressBar.createDiv('vault-bridge-progress-fill');
        this.progressFill.style.width = `${this.progress}%`;
        
        // 进度条上的光泽效果
        this.progressFill.createDiv('vault-bridge-progress-shine');
        
        // 添加进度百分比
        const progressInfo = progressContainer.createDiv('vault-bridge-progress-info');
        this.progressText = progressInfo.createDiv('vault-bridge-progress-text');
        this.progressText.textContent = `${this.progress}%`;
        
        // 添加消息内容区域
        const contentArea = contentEl.createDiv('vault-bridge-progress-content');
        
        this.messageEl = contentArea.createDiv('vault-bridge-progress-message');
        this.messageEl.innerHTML = `<span class="vault-bridge-message-icon">📝</span> ${this.message}`;
        
        // 添加步骤列表
        this.stepsList = contentArea.createDiv('vault-bridge-steps-list');
        
        // 存储引用以便更新
        this.progressBar = this.progressBar;
        this.progressText = this.progressText;
        this.messageEl = this.messageEl;
    }
    
    updateProgress(progress: number) {
        this.progress = Math.min(100, Math.max(0, progress));
        if (this.progressFill && this.progressText) {
            this.progressFill.style.width = `${this.progress}%`;
            this.progressText.textContent = `${this.progress}%`;
            
            // 更新状态图标
            if (this.progress === 100) {
                this.statusIcon.innerHTML = '✅';
                this.spinnerEl.style.display = 'none';
            }
        }
    }
    
    updateMessage(message: string) {
        this.message = message;
        if (this.messageEl) {
            // 添加淡入动画效果
            this.messageEl.style.opacity = '0';
            setTimeout(() => {
                this.messageEl.innerHTML = `<span class="vault-bridge-message-icon">📝</span> ${message}`;
                this.messageEl.style.opacity = '1';
            }, 150);
        }
    }
    
    addStep(text: string) {
        const step = { text, status: 'processing' as const };
        this.steps.push(step);
        this.renderSteps();
    }
    
    updateStep(index: number, status: 'pending' | 'processing' | 'completed' | 'error') {
        if (this.steps[index]) {
            this.steps[index].status = status;
            this.renderSteps();
        }
    }
    
    renderSteps() {
        if (!this.stepsList) return;
        
        this.stepsList.empty();
        this.steps.forEach((step, index) => {
            const stepEl = this.stepsList.createDiv('vault-bridge-step-item');
            stepEl.addClass(`vault-bridge-step-${step.status}`);
            
            const iconEl = stepEl.createSpan('vault-bridge-step-icon');
            switch (step.status) {
                case 'pending':
                    iconEl.innerHTML = '⏸️';
                    break;
                case 'processing':
                    iconEl.innerHTML = '⚙️';
                    break;
                case 'completed':
                    iconEl.innerHTML = '✅';
                    break;
                case 'error':
                    iconEl.innerHTML = '❌';
                    break;
            }
            
            stepEl.createSpan({ text: step.text, cls: 'vault-bridge-step-text' });
        });
    }
    
    setSuccess(message: string) {
        this.statusIcon.innerHTML = '✅';
        this.spinnerEl.style.display = 'none';
        this.updateProgress(100);
        this.updateMessage(message);
    }
    
    setError(message: string) {
        this.statusIcon.innerHTML = '❌';
        this.spinnerEl.style.display = 'none';
        this.updateMessage(message);
        if (this.progressFill) {
            this.progressFill.style.background = 'linear-gradient(90deg, #EF4444 0%, #DC2626 100%)';
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
        
        // 创建编辑说明头部
        const editHeader = this.editContainer.createDiv('vault-bridge-edit-header');
        
        const editInfo = editHeader.createDiv('vault-bridge-edit-info');
        const infoIcon = editInfo.createSpan('vault-bridge-edit-info-icon');
        infoIcon.innerHTML = '✏️';
        editInfo.createSpan({ 
            text: '手动编辑模式',
            cls: 'vault-bridge-edit-info-title'
        });
        editInfo.createEl('p', { 
            text: '您可以直接编辑内容来解决冲突，或使用下方快捷按钮快速选择版本。',
            cls: 'vault-bridge-edit-info-text'
        });
        
        // 添加快速操作按钮组
        const quickActionContainer = editHeader.createDiv('vault-bridge-quick-actions');
        
        const useLocalBtn = quickActionContainer.createEl('button', {
            cls: 'vault-bridge-quick-action-button vault-bridge-quick-local'
        });
        useLocalBtn.innerHTML = '📄 使用本地版本';
        useLocalBtn.addEventListener('click', () => {
            this.editTextarea.value = this.oldContent;
            this.updateCharCount();
        });
        
        const useRemoteBtn = quickActionContainer.createEl('button', {
            cls: 'vault-bridge-quick-action-button vault-bridge-quick-remote'
        });
        useRemoteBtn.innerHTML = '☁️ 使用链上版本';
        useRemoteBtn.addEventListener('click', () => {
            this.editTextarea.value = this.newContent;
            this.updateCharCount();
        });
        
        // 创建编辑器包装器（带行号）
        const editorWrapper = this.editContainer.createDiv('vault-bridge-editor-wrapper');
        
        // 创建文本编辑区
        this.editTextarea = editorWrapper.createEl('textarea', {
            cls: 'vault-bridge-edit-textarea',
            attr: {
                placeholder: '在此编辑内容...',
                spellcheck: 'false'
            }
        });
        this.editTextarea.value = this.oldContent; // 默认显示本地版本
        
        // 添加编辑器底部状态栏
        const editorFooter = this.editContainer.createDiv('vault-bridge-editor-footer');
        const charCount = editorFooter.createDiv('vault-bridge-char-count');
        charCount.innerHTML = `<span class="vault-bridge-count-label">字符数：</span><span class="vault-bridge-count-value">${this.oldContent.length}</span>`;
        
        const lineCount = editorFooter.createDiv('vault-bridge-line-count');
        lineCount.innerHTML = `<span class="vault-bridge-count-label">行数：</span><span class="vault-bridge-count-value">${this.oldContent.split('\n').length}</span>`;
        
        // 更新字符统计
        this.editTextarea.addEventListener('input', () => {
            this.updateCharCount();
        });
        
        // 存储统计元素引用
        (this.editTextarea as any).charCountEl = charCount;
        (this.editTextarea as any).lineCountEl = lineCount;
        
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
    
    updateCharCount() {
        const content = this.editTextarea.value;
        const charCountEl = (this.editTextarea as any).charCountEl;
        const lineCountEl = (this.editTextarea as any).lineCountEl;
        
        if (charCountEl) {
            charCountEl.innerHTML = `<span class="vault-bridge-count-label">字符数：</span><span class="vault-bridge-count-value">${content.length}</span>`;
        }
        
        if (lineCountEl) {
            const lines = content.split('\n').length;
            lineCountEl.innerHTML = `<span class="vault-bridge-count-label">行数：</span><span class="vault-bridge-count-value">${lines}</span>`;
        }
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
            
            // 聚焦到文本框
            setTimeout(() => {
                this.editTextarea.focus();
            }, 100);
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
