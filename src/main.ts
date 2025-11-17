import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, FileSystemAdapter, Menu } from 'obsidian';
import { MnemonicWallet } from './mnemonic-wallet';
import { initVault, pushToChain, pullFromChain } from './vault-sync';
import { VaultSyncModal, ConfirmationModal, ProgressModal } from './components/modal';
import { Vault } from './server/vault-server';
import * as Constants from './constant';

// 声明环境变量类型
declare const ENABLE_DEV_MODE: boolean;

// 插件设置接口
interface VaultBridgeSettings {
    passphrase: string;
    address: string;
    epoch: number;
    lastSyncTimestamp: number;
    autoSync: boolean;
    autoSyncInterval: number; // 以分钟为单位
    debugMode: boolean; // 调试模式开关
    customPackageId: string; // 自定义PackageId
}

// 默认设置
const DEFAULT_SETTINGS: VaultBridgeSettings = {
    passphrase: '',
    address: '',
    epoch: 10,
    lastSyncTimestamp: 0,
    autoSync: false,
    autoSyncInterval: 60,
    debugMode: false,
    customPackageId: ''
}

export default class VaultBridgePlugin extends Plugin {
    settings: VaultBridgeSettings;
    mnemonicWallet: MnemonicWallet;
    vault: Vault | undefined;
    epoch: number;
    autoSyncIntervalId: number | null = null;
    statusBarItem: HTMLElement;
    
    // 获取当前使用的PackageId
    getPackageId(): string {
        if (this.settings.debugMode && this.settings.customPackageId) {
            return this.settings.customPackageId;
        }
        return Constants.PACKAGE_ID;
    }
    
    async onload() {
        await this.loadSettings();

        // 添加样式
        this.addStyle();
        
        try {
            if (this.settings.passphrase === '') {
                new Notice('请先配置Vault Bridge插件');
            } else {
                this.mnemonicWallet = new MnemonicWallet(this.settings.passphrase);
                console.log(`钱包地址: ${this.mnemonicWallet.getAddress()}`);
                if (this.settings.address === '') {
                    this.settings.address = this.mnemonicWallet.getAddress();
                    await this.saveSettings();
                }
            }
            this.epoch = this.settings.epoch;
        } catch (error) {
            console.error("初始化助记词钱包失败", error);
        }

        // 在左侧工具栏添加图标
        const ribbonIconEl = this.addRibbonIcon('sync', 'Vault Bridge', (evt: MouseEvent) => {
            if (this.settings.passphrase === '') {
                new Notice('请先配置Vault Bridge插件');
                return;
            }

            // 显示操作菜单
            const menu = new Menu();
            
            // 初始化按钮
            menu.addItem((item) => {
                return item
                    .setTitle('初始化')
                    .setIcon('settings')
                    .onClick(async () => {
                        const vaultName = this.app.vault.getName();
                        
                        const confirmModal = new ConfirmationModal(
                            this.app,
                            '初始化Vault',
                            `确定要初始化名为 "${vaultName}" 的Vault吗？`,
                            async () => {
                                try {
                                    const progressModal = new ProgressModal(this.app, '初始化进行中');
                                    progressModal.open();
                                    progressModal.updateMessage('正在连接区块链...');
                                    
                                    this.vault = await initVault(vaultName, this.getMnemonicWallet(), this.getPackageId());
                                    
                                    if (this.vault) {
                                        progressModal.updateProgress(100);
                                        progressModal.updateMessage('初始化成功!');
                                        setTimeout(() => {
                                            progressModal.close();
                                            new Notice(`初始化成功，VaultID: ${this.vault?.id}`);
                                        }, 1500);
                                    } else {
                                        progressModal.close();
                                        new Notice('初始化失败');
                                    }
                                } catch (error) {
                                    console.error('初始化过程出错', error);
                                    new Notice('初始化过程出错，请查看控制台');
                                }
                            }
                        );
                        confirmModal.open();
                    });
            });
            
            // 上传按钮
            menu.addItem((item) => {
                return item
                    .setTitle('上传笔记')
                    .setIcon('upload')
                    .onClick(async () => {
                        try {
                            new Notice('准备上传笔记到区块链');
                            const vaultPath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
                            const vaultName = this.app.vault.getName();
                            const files = this.app.vault.getMarkdownFiles();
                            
                            const confirmModal = new ConfirmationModal(
                                this.app,
                                '上传笔记',
                                `确定要上传 ${files.length} 个笔记文件到区块链吗？`,
                                async () => {
                                    const progressModal = new ProgressModal(this.app, '上传进行中');
                                    progressModal.open();
                                    
                                    let vault = await initVault(vaultName, this.getMnemonicWallet(), this.getPackageId());
                                    if (vault) {
                                        await pushToChain(
                                            vault, 
                                            vaultPath, 
                                            files, 
                                            this.getMnemonicWallet(), 
                                            this.getEpoch(), 
                                            (message: string, progress?: number) => {
                                                progressModal.updateMessage(message);
                                                if (progress !== undefined) {
                                                    progressModal.updateProgress(progress);
                                                }
                                            },
                                            this.app,
                                            this.getPackageId()
                                        );
                                        
                                        // 更新最后同步时间
                                        this.settings.lastSyncTimestamp = Date.now();
                                        await this.saveSettings();
                                        this.updateStatusBar();
                                        
                                        progressModal.close();
                                    }
                                }
                            );
                            confirmModal.open();
                        } catch (e) {
                            console.error('上传过程出错', e);
                            new Notice('上传过程出错，请查看控制台');
                        }
                    });
            });
            
            // 下载按钮
            menu.addItem((item) => {
                return item
                    .setTitle('下载笔记')
                    .setIcon('download')
                    .onClick(async () => {
                        try {
                            new Notice('准备从区块链下载笔记');
                            const vaultPath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
                            const vaultName = this.app.vault.getName();
                            const files = this.app.vault.getMarkdownFiles();
                            
                            const confirmModal = new ConfirmationModal(
                                this.app,
                                '下载笔记',
                                '确定要从区块链下载笔记吗？这可能会覆盖本地文件。',
                                async () => {
                                    const progressModal = new ProgressModal(this.app, '下载进行中');
                                    progressModal.open();
                                    
                                    let vault = await initVault(vaultName, this.getMnemonicWallet(), this.getPackageId());
                                    if (!vault) {
                                        progressModal.close();
                                        new Notice('下载失败，请先初始化');
                                        return;
                                    }
                                    
                                    progressModal.updateMessage('正在下载文件...');
                                    
                                    let dataAdapter = this.app.vault.adapter;
                                    await pullFromChain(
                                        vault, 
                                        vaultPath, 
                                        files, 
                                        this.mnemonicWallet, 
                                        dataAdapter,
                                        (message: string, progress?: number) => {
                                            progressModal.updateMessage(message);
                                            if (progress !== undefined) {
                                                progressModal.updateProgress(progress);
                                            }
                                        },
                                        this.app,
                                        this.getPackageId()
                                    );
                                    
                                    // 更新最后同步时间
                                    this.settings.lastSyncTimestamp = Date.now();
                                    await this.saveSettings();
                                    this.updateStatusBar();
                                    
                                    progressModal.updateMessage('下载完成!');
                                    progressModal.updateProgress(100);
                                    setTimeout(() => {
                                        progressModal.close();
                                        new Notice('从区块链下载笔记完成');
                                    }, 1500);
                                }
                            );
                            confirmModal.open();
                        } catch (e) {
                            console.error('下载过程出错', e);
                            new Notice('下载过程出错，请查看控制台');
                        }
                    });
            });
            
            menu.addSeparator();
            
            // 同步状态按钮
            menu.addItem((item) => {
                return item
                    .setTitle('同步状态')
                    .setIcon('info')
                    .onClick(() => {
                        let lastSync = '从未';
                        if (this.settings.lastSyncTimestamp > 0) {
                            const date = new Date(this.settings.lastSyncTimestamp);
                            lastSync = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
                        }
                        
                        const modal = new VaultSyncModal(
                            this.app,
                            '同步状态信息',
                            `最后同步时间: ${lastSync}\n` +
                            `钱包地址: ${this.settings.address}\n` +
                            `存储时长: ${this.settings.epoch} epochs\n` +
                            `自动同步: ${this.settings.autoSync ? '开启' : '关闭'}\n` +
                            `同步间隔: ${this.settings.autoSyncInterval} 分钟`
                        );
                        modal.open();
                    });
            });
            
            // 在鼠标位置显示菜单
            menu.showAtMouseEvent(evt);
        });
        
        // 设置图标样式
        ribbonIconEl.addClass('vault-bridge-ribbon-icon');
        
        // 添加状态栏
        this.statusBarItem = this.addStatusBarItem();
        this.updateStatusBar();

        // 添加命令到命令面板
        this.addCommands();

        // 添加设置选项卡
        this.addSettingTab(new VaultBridgeSettingTab(this.app, this));

        // 注册自动同步
        if (this.settings.autoSync) {
            this.startAutoSync();
        }
    }
    
    // 添加命令到命令面板
    addCommands() {
        // 上传命令
        this.addCommand({
            id: 'upload-notes',
            name: '上传笔记到区块链',
            callback: async () => {
                if (this.settings.passphrase === '') {
                    new Notice('请先在设置中配置助记词');
                    return;
                }
                await this.performUpload();
            }
        });
        
        // 下载命令
        this.addCommand({
            id: 'download-notes',
            name: '从区块链下载笔记',
            callback: async () => {
                if (this.settings.passphrase === '') {
                    new Notice('请先在设置中配置助记词');
                    return;
                }
                await this.performDownload();
            }
        });
        
        // 初始化命令
        this.addCommand({
            id: 'initialize-vault',
            name: '初始化 Vault',
            callback: async () => {
                if (this.settings.passphrase === '') {
                    new Notice('请先在设置中配置助记词');
                    return;
                }
                await this.performInitialize();
            }
        });
        
        // 查看同步状态命令
        this.addCommand({
            id: 'sync-status',
            name: '查看同步状态',
            callback: () => {
                this.showSyncStatus();
            }
        });
    }
    
    // 执行上传
    async performUpload() {
        try {
            new Notice('准备上传笔记到区块链');
            const vaultPath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
            const vaultName = this.app.vault.getName();
            const files = this.app.vault.getMarkdownFiles();
            
            const confirmModal = new ConfirmationModal(
                this.app,
                '上传笔记',
                `确定要上传 ${files.length} 个笔记文件到区块链吗？`,
                async () => {
                    const progressModal = new ProgressModal(this.app, '上传进行中');
                    progressModal.open();
                    
                    let vault = await initVault(vaultName, this.getMnemonicWallet(), this.getPackageId());
                    if (vault) {
                        await pushToChain(
                            vault, 
                            vaultPath, 
                            files, 
                            this.getMnemonicWallet(), 
                            this.getEpoch(), 
                            (message: string, progress?: number) => {
                                progressModal.updateMessage(message);
                                if (progress !== undefined) {
                                    progressModal.updateProgress(progress);
                                }
                            },
                            this.app,
                            this.getPackageId()
                        );
                        
                        this.settings.lastSyncTimestamp = Date.now();
                        await this.saveSettings();
                        this.updateStatusBar();
                        
                        progressModal.close();
                    }
                }
            );
            confirmModal.open();
        } catch (e) {
            console.error('上传过程出错', e);
            new Notice('上传过程出错，请查看控制台');
        }
    }
    
    // 执行下载
    async performDownload() {
        try {
            new Notice('准备从区块链下载笔记');
            const vaultPath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
            const vaultName = this.app.vault.getName();
            const files = this.app.vault.getMarkdownFiles();
            
            const confirmModal = new ConfirmationModal(
                this.app,
                '下载笔记',
                '确定要从区块链下载笔记吗？这可能会覆盖本地文件。',
                async () => {
                    const progressModal = new ProgressModal(this.app, '下载进行中');
                    progressModal.open();
                    
                    let vault = await initVault(vaultName, this.getMnemonicWallet(), this.getPackageId());
                    if (!vault) {
                        progressModal.close();
                        new Notice('下载失败，请先初始化');
                        return;
                    }
                    
                    progressModal.updateMessage('正在下载文件...');
                    
                    let dataAdapter = this.app.vault.adapter;
                    await pullFromChain(
                        vault, 
                        vaultPath, 
                        files, 
                        this.mnemonicWallet, 
                        dataAdapter,
                        (message: string, progress?: number) => {
                            progressModal.updateMessage(message);
                            if (progress !== undefined) {
                                progressModal.updateProgress(progress);
                            }
                        },
                        this.app,
                        this.getPackageId()
                    );
                    
                    this.settings.lastSyncTimestamp = Date.now();
                    await this.saveSettings();
                    this.updateStatusBar();
                    
                    progressModal.updateMessage('下载完成!');
                    progressModal.updateProgress(100);
                    setTimeout(() => {
                        progressModal.close();
                        new Notice('从区块链下载笔记完成');
                    }, 1500);
                }
            );
            confirmModal.open();
        } catch (e) {
            console.error('下载过程出错', e);
            new Notice('下载过程出错，请查看控制台');
        }
    }
    
    // 执行初始化
    async performInitialize() {
        const vaultName = this.app.vault.getName();
        
        const confirmModal = new ConfirmationModal(
            this.app,
            '初始化Vault',
            `确定要初始化名为 "${vaultName}" 的Vault吗？`,
            async () => {
                try {
                    const progressModal = new ProgressModal(this.app, '初始化进行中');
                    progressModal.open();
                    progressModal.updateMessage('正在连接区块链...');
                    
                    this.vault = await initVault(vaultName, this.getMnemonicWallet(), this.getPackageId());
                    
                    if (this.vault) {
                        progressModal.updateProgress(100);
                        progressModal.updateMessage('初始化成功!');
                        setTimeout(() => {
                            progressModal.close();
                            new Notice(`初始化成功，VaultID: ${this.vault?.id}`);
                        }, 1500);
                    } else {
                        progressModal.close();
                        new Notice('初始化失败');
                    }
                } catch (error) {
                    console.error('初始化过程出错', error);
                    new Notice('初始化过程出错，请查看控制台');
                }
            }
        );
        confirmModal.open();
    }
    
    // 显示同步状态
    showSyncStatus() {
        let lastSync = '从未';
        if (this.settings.lastSyncTimestamp > 0) {
            const date = new Date(this.settings.lastSyncTimestamp);
            lastSync = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
        }
        
        const modal = new VaultSyncModal(
            this.app,
            '同步状态信息',
            `最后同步时间: ${lastSync}\n` +
            `钱包地址: ${this.settings.address}\n` +
            `存储时长: ${this.settings.epoch} epochs\n` +
            `自动同步: ${this.settings.autoSync ? '开启' : '关闭'}\n` +
            `同步间隔: ${this.settings.autoSyncInterval} 分钟`
        );
        modal.open();
    }
    
    // 添加样式
    addStyle() {
        const styleEl = document.createElement('style');
        styleEl.id = 'vault-bridge-styles';
        styleEl.textContent = `
            .vault-bridge-ribbon-icon {
                color: var(--vault-bridge-primary-color);
                opacity: 0.8;
                transition: all 0.3s ease;
            }
            
            .vault-bridge-ribbon-icon:hover {
                opacity: 1;
                transform: scale(1.1);
            }
            
            .vault-bridge-ribbon-icon.is-active {
                color: var(--vault-bridge-success-color);
                animation: pulse 2s infinite;
            }
            
            @keyframes pulse {
                0% {
                    transform: scale(1);
                }
                50% {
                    transform: scale(1.1);
                }
                100% {
                    transform: scale(1);
                }
            }
        `;
        document.head.appendChild(styleEl);
    }

    
    // 更新状态栏
    updateStatusBar() {
        let statusText = '未同步';
        
        if (this.settings.lastSyncTimestamp > 0) {
            const lastSync = new Date(this.settings.lastSyncTimestamp);
            const now = new Date();
            const diffHours = Math.round((now.getTime() - lastSync.getTime()) / (1000 * 60 * 60));
            
            if (diffHours < 24) {
                statusText = `最近同步: ${diffHours}小时前`;
            } else {
                const diffDays = Math.round(diffHours / 24);
                statusText = `最近同步: ${diffDays}天前`;
            }
        }
        
        this.statusBarItem.setText(`📝 Vault Bridge: ${statusText}`);
    }
    
    // 开始自动同步
    startAutoSync() {
        if (this.autoSyncIntervalId !== null) {
            window.clearInterval(this.autoSyncIntervalId);
        }
        
        this.autoSyncIntervalId = window.setInterval(async () => {
            try {
                // 检查是否应该同步
                const now = Date.now();
                const lastSync = this.settings.lastSyncTimestamp || 0;
                const intervalMs = this.settings.autoSyncInterval * 60 * 1000;
                
                if (now - lastSync >= intervalMs) {
                    const vaultPath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
                    const vaultName = this.app.vault.getName();
                    const files = this.app.vault.getMarkdownFiles();
                    
                    let vault = await initVault(vaultName, this.getMnemonicWallet(), this.getPackageId());
                    if (vault) {
                        await pushToChain(
                            vault, 
                            vaultPath, 
                            files, 
                            this.getMnemonicWallet(), 
                            this.getEpoch(), 
                            (message: string, progress?: number) => {
                                console.log(`自动同步: ${message} ${progress !== undefined ? progress + '%' : ''}`);
                            },
                            this.app,
                            this.getPackageId()
                        );
                        
                        // 更新最后同步时间
                        this.settings.lastSyncTimestamp = Date.now();
                        await this.saveSettings();
                        this.updateStatusBar();
                        
                        new Notice('自动同步完成');
                    }
                }
            } catch (error) {
                console.error('自动同步失败', error);
                new Notice('自动同步失败，请查看控制台');
            }
        }, 60000); // 检查间隔：1分钟
    }
    
    // 停止自动同步
    stopAutoSync() {
        if (this.autoSyncIntervalId !== null) {
            window.clearInterval(this.autoSyncIntervalId);
            this.autoSyncIntervalId = null;
        }
    }

    setEpoch(epoch: number) {
        this.epoch = epoch;
    }
    
    showNotice(message: string) {
        new Notice(message);
    }
    
    getEpoch() {
        return this.epoch;
    }

    getMnemonicWallet() {
        return this.mnemonicWallet;
    }
    
    onunload() {
        // 清理操作
        if (this.mnemonicWallet) {
            this.mnemonicWallet.destroy();
        }
        
        // 停止自动同步
        this.stopAutoSync();
        
        // 移除样式
        const styleEl = document.getElementById('vault-bridge-styles');
        if (styleEl) {
            styleEl.remove();
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class VaultBridgeSettingTab extends PluginSettingTab {
    plugin: VaultBridgePlugin;
    addressDisplay: HTMLSpanElement;

    constructor(app: App, plugin: VaultBridgePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.classList.add('vault-bridge-settings');
        
        containerEl.createEl('h2', { text: 'Vault Bridge 设置' });
        
        // 快捷操作区域
        containerEl.createEl('h3', { text: '快捷操作' });
        
        const quickActionsDiv = containerEl.createDiv('vault-bridge-quick-actions');
        quickActionsDiv.style.cssText = 'display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap;';
        
        // 上传按钮
        const uploadButton = quickActionsDiv.createEl('button', { text: '⬆️ 上传笔记' });
        uploadButton.style.cssText = 'padding: 10px 20px; cursor: pointer; background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 5px;';
        uploadButton.onclick = async () => {
            if (this.plugin.settings.passphrase === '') {
                new Notice('请先配置助记词');
                return;
            }
            await this.plugin.performUpload();
        };
        
        // 下载按钮
        const downloadButton = quickActionsDiv.createEl('button', { text: '⬇️ 下载笔记' });
        downloadButton.style.cssText = 'padding: 10px 20px; cursor: pointer; background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 5px;';
        downloadButton.onclick = async () => {
            if (this.plugin.settings.passphrase === '') {
                new Notice('请先配置助记词');
                return;
            }
            await this.plugin.performDownload();
        };
        
        // 初始化按钮
        const initButton = quickActionsDiv.createEl('button', { text: '🔧 初始化' });
        initButton.style.cssText = 'padding: 10px 20px; cursor: pointer; background: var(--interactive-normal); color: var(--text-normal); border: 1px solid var(--background-modifier-border); border-radius: 5px;';
        initButton.onclick = async () => {
            if (this.plugin.settings.passphrase === '') {
                new Notice('请先配置助记词');
                return;
            }
            await this.plugin.performInitialize();
        };
        
        // 状态按钮
        const statusButton = quickActionsDiv.createEl('button', { text: 'ℹ️ 同步状态' });
        statusButton.style.cssText = 'padding: 10px 20px; cursor: pointer; background: var(--interactive-normal); color: var(--text-normal); border: 1px solid var(--background-modifier-border); border-radius: 5px;';
        statusButton.onclick = () => {
            this.plugin.showSyncStatus();
        };
        
        containerEl.createEl('h3', { text: '基础设置' });
        
        // 助记词设置
        new Setting(containerEl)
            .setName('助记词')
            .setDesc('输入您的助记词以生成钱包')
            .addText(text => text
                .setPlaceholder('输入您的助记词')
                .setValue(this.plugin.settings.passphrase)
                .onChange(async (value) => {
                    try {
                        if (value !== "" && this.plugin.settings.passphrase !== value) {
                            this.plugin.mnemonicWallet = new MnemonicWallet(value);
                            this.plugin.settings.address = this.plugin.mnemonicWallet.getAddress();
                            
                            // 显示钱包地址
                            if (this.addressDisplay) {
                                this.addressDisplay.textContent = `当前钱包地址: ${this.plugin.settings.address}`;
                            }
                        }
                    } catch (error) {
                        console.error("初始化助记词钱包失败", error);
                    }
                    this.plugin.settings.passphrase = value;
                    await this.plugin.saveSettings();
                }));
        
        // 显示钱包地址
        const addressContainer = containerEl.createDiv('vault-bridge-status vault-bridge-status-info');
        this.addressDisplay = addressContainer.createSpan();
        this.addressDisplay.textContent = this.plugin.settings.address 
            ? `当前钱包地址: ${this.plugin.settings.address}` 
            : '未设置钱包';
        
        // Epoch设置
        new Setting(containerEl)
            .setName('Epoch 数量')
            .setDesc('文件在Walrus上存储的epoch数量，默认为10')
            .addText(text => text
                .setPlaceholder('输入Epoch数量')
                .setValue(this.plugin.settings.epoch.toString())
                .onChange(async (value) => {
                    try {
                        const tempEpoch = parseInt(value);
                        if (tempEpoch > 0) {
                            this.plugin.settings.epoch = tempEpoch;
                            await this.plugin.saveSettings();
                            this.plugin.setEpoch(tempEpoch);
                        }
                    } catch (error) {
                        console.error("Epoch值无效", error);
                    }
                }));
        
        // 自动同步设置
        new Setting(containerEl)
            .setName('启用自动同步')
            .setDesc('定期自动将笔记同步到区块链')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSync)
                .onChange(async (value) => {
                    this.plugin.settings.autoSync = value;
                    await this.plugin.saveSettings();
                    
                    if (value) {
                        this.plugin.startAutoSync();
                    } else {
                        this.plugin.stopAutoSync();
                    }
                }));
        
        // 同步间隔设置
        new Setting(containerEl)
            .setName('同步间隔')
            .setDesc('自动同步的时间间隔（分钟）')
            .addText(text => text
                .setPlaceholder('输入分钟数')
                .setValue(this.plugin.settings.autoSyncInterval.toString())
                .onChange(async (value) => {
                    try {
                        const interval = parseInt(value);
                        if (interval > 0) {
                            this.plugin.settings.autoSyncInterval = interval;
                            await this.plugin.saveSettings();
                            
                            // 重启自动同步（如果已启用）
                            if (this.plugin.settings.autoSync) {
                                this.plugin.stopAutoSync();
                                this.plugin.startAutoSync();
                            }
                        }
                    } catch (error) {
                        console.error("同步间隔无效", error);
                    }
                }));
        
        // 最后同步时间
        if (this.plugin.settings.lastSyncTimestamp > 0) {
            const lastSyncDate = new Date(this.plugin.settings.lastSyncTimestamp);
            const lastSyncInfo = containerEl.createDiv('vault-bridge-status vault-bridge-status-success');
            lastSyncInfo.createSpan().textContent = `最后同步时间: ${lastSyncDate.toLocaleString()}`;
        }
        
        // 添加清除同步记录按钮
        new Setting(containerEl)
            .setName('重置同步状态')
            .setDesc('清除最后同步时间记录')
            .addButton(button => button
                .setButtonText('重置')
                .onClick(async () => {
                    this.plugin.settings.lastSyncTimestamp = 0;
                    await this.plugin.saveSettings();
                    this.plugin.updateStatusBar();
                    new Notice('同步状态已重置');
                    this.display();
                }));
        
        // 开发者模式设置（仅在构建时启用时显示）
        if (typeof ENABLE_DEV_MODE !== 'undefined' && ENABLE_DEV_MODE) {
            containerEl.createEl('h3', { text: '开发者选项' });
            
            const devWarning = containerEl.createDiv('vault-bridge-status vault-bridge-status-warning');
            devWarning.style.cssText = 'background: var(--background-modifier-error-hover); color: var(--text-error); padding: 10px; border-radius: 5px; margin-bottom: 15px;';
            devWarning.createSpan().textContent = '⚠️ 警告：开发者选项仅供调试使用，修改这些选项可能导致功能异常！';
            
            // 调试模式开关
            new Setting(containerEl)
                .setName('启用调试模式')
                .setDesc('启用后可以使用自定义的Package ID')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.debugMode)
                    .onChange(async (value) => {
                        this.plugin.settings.debugMode = value;
                        await this.plugin.saveSettings();
                        this.display(); // 刷新界面以显示/隐藏PackageId输入框
                    }));
            
            // 自定义Package ID（仅在调试模式开启时显示）
            if (this.plugin.settings.debugMode) {
                new Setting(containerEl)
                    .setName('自定义 Package ID')
                    .setDesc('输入自定义的Package ID（留空使用默认值）')
                    .addText(text => text
                        .setPlaceholder('0x...')
                        .setValue(this.plugin.settings.customPackageId)
                        .onChange(async (value) => {
                            this.plugin.settings.customPackageId = value;
                            await this.plugin.saveSettings();
                        }));
                
                // 显示当前使用的Package ID
                const currentPackageIdDiv = containerEl.createDiv('vault-bridge-status vault-bridge-status-info');
                currentPackageIdDiv.style.cssText = 'background: var(--background-modifier-form-field); padding: 10px; border-radius: 5px; margin-top: 10px; font-family: monospace; word-break: break-all;';
                const packageId = this.plugin.getPackageId();
                currentPackageIdDiv.innerHTML = `
                    <div><strong>当前使用的 Package ID:</strong></div>
                    <div style="color: var(--text-accent); margin-top: 5px;">${packageId}</div>
                `;
            }
        }
    }
}
