import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, FileSystemAdapter, Menu } from 'obsidian';
import { MnemonicWallet } from './mnemonic-wallet';
import { initVault, pushToChain, pullFromChain } from './vault-sync';
import { VaultSyncModal, ConfirmationModal, ProgressModal } from './components/modal';
import { Vault } from './server/vault-server';

// 插件设置接口
interface VaultBridgeSettings {
    passphrase: string;
    address: string;
    epoch: number;
    lastSyncTimestamp: number;
    autoSync: boolean;
    autoSyncInterval: number; // 以分钟为单位
}

// 默认设置
const DEFAULT_SETTINGS: VaultBridgeSettings = {
    passphrase: '',
    address: '',
    epoch: 10,
    lastSyncTimestamp: 0,
    autoSync: false,
    autoSyncInterval: 60
}

export default class VaultBridgePlugin extends Plugin {
    settings: VaultBridgeSettings;
    mnemonicWallet: MnemonicWallet;
    vault: Vault | undefined;
    epoch: number;
    autoSyncIntervalId: number | null = null;
    statusBarItem: HTMLElement;
    
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
        const ribbonIconEl = this.addRibbonIcon('cloud-sync', 'Vault Bridge', (evt: MouseEvent) => {
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
                    .setIcon('webhook')
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
                                    
                                    this.vault = await initVault(vaultName, this.getMnemonicWallet());
                                    
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
                    .setIcon('upload-cloud')
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
                                    
                                    let vault = await initVault(vaultName, this.getMnemonicWallet());
                                    if (vault) {
                                        await pushToChain(
                                            vault, 
                                            vaultPath, 
                                            files, 
                                            this.getMnemonicWallet(), 
                                            this.getEpoch(), 
                                            (message: string) => {
                                                progressModal.updateMessage(message);
                                            },
                                            this.app
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
                    .setIcon('download-cloud')
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
                                    
                                    let vault = await initVault(vaultName, this.getMnemonicWallet());
                                    if (!vault) {
                                        progressModal.close();
                                        new Notice('下载失败，请先初始化');
                                        return;
                                    }
                                    
                                    progressModal.updateMessage('正在下载文件...');
                                    
                                    let dataAdapter = this.app.vault.adapter;
                                    await pullFromChain(vault, vaultPath, files, this.mnemonicWallet, dataAdapter);
                                    
                                    // 更新最后同步时间
                                    this.settings.lastSyncTimestamp = Date.now();
                                    await this.saveSettings();
                                    this.updateStatusBar();
                                    
                                    progressModal.updateMessage('下载完成!');
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

        // 添加设置选项卡
        this.addSettingTab(new VaultBridgeSettingTab(this.app, this));

        // 注册自动同步
        if (this.settings.autoSync) {
            this.startAutoSync();
        }
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
                    
                    let vault = await initVault(vaultName, this.getMnemonicWallet());
                    if (vault) {
                        await pushToChain(
                            vault, 
                            vaultPath, 
                            files, 
                            this.getMnemonicWallet(), 
                            this.getEpoch(), 
                            (message: string) => {
                                console.log(`自动同步: ${message}`);
                            },
                            this.app
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
    }
}
