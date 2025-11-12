import { App, DataAdapter, TFile, normalizePath } from 'obsidian';
import { getVaultByAddress, Vault, VaultDir } from './server/vault-server';
import { MnemonicWallet } from './mnemonic-wallet';
import { Transaction } from '@mysten/sui/transactions';
import { PACKAGE_ID, NET_WORK } from './constant';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { SealUtil } from './utils/sealUtil';
import { VaultSyncModal, DiffModal } from './components/modal';

export async function initVault(vaultName: string, wallet: MnemonicWallet): Promise<Vault | undefined> {
    // 初始化，先获取到vault的名称，去链上找到该钱包是否有该vault
    // 有就提示同步，否则提示链上无对应对象，需要先上传
    const address = wallet.getAddress();
    let vault: Vault | undefined = await getVaultByAddress(address, vaultName);
    console.log("初始化vault:", vault);
    
    if (!vault) {
        // 上传 - 先创建一个vault，然后上传目录
        const tx = new Transaction();
        tx.setSender(address);
        tx.setGasBudget(10000000);
        
        const rootDir = tx.moveCall({
            package: PACKAGE_ID,
            module: 'coral_sync',
            function: 'new_root_directory',
            arguments: [tx.pure.string(vaultName), tx.object("0x6")],
        });
        
        tx.moveCall({
            package: PACKAGE_ID,
            module: 'coral_sync',
            function: 'transfer_dir',
            arguments: [tx.object(rootDir), tx.pure.address(address)],
        });
        
        const suiClient = new SuiClient({ url: getFullnodeUrl(NET_WORK) });
        try {
            let txBytes = await tx.build({ client: suiClient });
            let signature = await wallet.signTransaction(txBytes);
            
            let txResult = await suiClient.executeTransactionBlock({
                transactionBlock: txBytes,
                signature: signature,
            });
            console.log("交易结果:", txResult);
        } catch (e) {
            console.log("交易构建错误:", e);
        }
        
        vault = await getVaultByAddress(address, vaultName);
        if (!vault) {
            return await getVaultByAddress(address, vaultName);
        }
    }
    
    return vault;
}

export async function pushToChain(
    vault: Vault, 
    vaultLocalPath: string, 
    allMarkdownFiles: TFile[], 
    wallet: MnemonicWallet, 
    epoch: number, 
    notifyProgress: (message: string, progress?: number) => void, 
    app: App
) {
    console.log("推送vault", vault.name, vaultLocalPath);
    let address = wallet.getAddress();
    
    if (vault) {
        let vaultId = vault.id;
        let map = flattenVaultFilesOptimized(vault);
        console.log("vaultMap", map);
        
        // 检查目录是否创建，没有就创建
        let newDirMap = new Map<string, any>();
        let waitTransferDirs = [];
        let waitTransferFiles = [];
        let tx = new Transaction();
        tx.setSender(address);
        
        // 上传文件
        let props = {
            vaultId: vaultId,
            moduleName: 'coral_sync',
            wallet: wallet,
            packageId: PACKAGE_ID,
        };
        const { handleSubmit } = SealUtil(props);
        
        // 计算需要上传的文件数量
        const filesToUpload = allMarkdownFiles.filter(file => !map.has(file.path));
        const totalFiles = filesToUpload.length;
        let processedFiles = 0;

        notifyProgress(`准备上传 ${totalFiles} 个文件...`, 0);

        for (let j = 0; j < allMarkdownFiles.length; j++) {
            let file = allMarkdownFiles[j];
            if (map.has(file.path)) {
                // 该文件已上传
                console.log("文件已存在:", file.path);
            } else {
                // 该文件未上传
                let currFilePathSplit = file.path.split("/");
                let tempPath = "";
                console.log("文件路径分割:", currFilePathSplit);
                let parentObjMap = new Map<string, any>();

                parentObjMap.set(currFilePathSplit[0], vaultId);
                for (let i = 0; i < currFilePathSplit.length - 1; i++) {
                    let currDir = currFilePathSplit[i];
                    if (tempPath == "") {
                        tempPath = currDir;
                    } else {
                        tempPath = tempPath + "/" + currDir;
                    }
                    if (newDirMap.has(tempPath)) {
                        parentObjMap.set(tempPath + "/" + currFilePathSplit[i + 1], newDirMap.get(tempPath));
                        continue;
                    }
                    let parent = parentObjMap.get(tempPath);
                    notifyProgress(`处理目录: ${tempPath}`, Math.floor((processedFiles / totalFiles) * 80));
                    // 判断 parent 是字符串ID还是交易中的对象引用
                    let parentArg = typeof parent === 'string' ? tx.object(parent) : parent;
                    let par = tx.moveCall({
                        package: PACKAGE_ID,
                        module: 'coral_sync',
                        function: 'new_directory',
                        arguments: [tx.pure.string(currDir), parentArg, tx.object("0x6")],
                    });
                    newDirMap.set(tempPath, par);
                    parentObjMap.set(tempPath + "/" + currFilePathSplit[i + 1], par);
                    waitTransferDirs.push(par);
                }
                
                // 上传文件
                const fs = require('fs');
                const path = require('path');
                const sourcePath = path.join(vaultLocalPath, file.path);
                let parent_dir = parentObjMap.get(file.path);
                const data = fs.readFileSync(sourcePath);
                const fileName = path.basename(sourcePath);
                console.log("文件名:", fileName);
                
                const currentProgress = Math.floor((processedFiles / totalFiles) * 80);
                notifyProgress(`正在上传: ${fileName} (${processedFiles + 1}/${totalFiles})`, currentProgress);
                
                const result = await handleSubmit(new File([data], fileName, {
                    type: 'text/plain',
                    lastModified: Date.now()
                }), epoch);
                
                if (result) {
                    processedFiles++;
                    const newProgress = Math.floor((processedFiles / totalFiles) * 80);
                    notifyProgress(`文件 ${fileName} 已保存至Walrus (${processedFiles}/${totalFiles})`, newProgress);
                    // 判断 parent_dir 是字符串ID还是交易中的对象引用
                    let parentDirArg = typeof parent_dir === 'string' ? tx.object(parent_dir) : parent_dir;
                    let fileResult = tx.moveCall({
                        target: PACKAGE_ID + '::coral_sync::new_file',
                        arguments: [tx.pure.string(fileName), tx.pure.string(result.blobId), tx.pure.u64(result.endEpoch), parentDirArg, tx.object("0x6")],
                    });
                    waitTransferFiles.push(fileResult);
                }
            }
        }
        
        // 处理目录
        waitTransferDirs.forEach(dir => {
            tx.moveCall({
                package: PACKAGE_ID,
                module: 'coral_sync',
                function: 'transfer_dir',
                arguments: [tx.object(dir), tx.pure.address(address)],
            });
        });
        
        // 处理文件
        waitTransferFiles.forEach(file => {
            tx.moveCall({
                package: PACKAGE_ID,
                module: 'coral_sync',
                function: 'transfer_file',
                arguments: [tx.object(file), tx.pure.address(address)],
            });
        });
        
        notifyProgress("正在同步数据至链上，请稍后...", 85);
        const suiClient = new SuiClient({ url: getFullnodeUrl(NET_WORK) });
        
        try {
            let txBytes = await tx.build({ client: suiClient });
            notifyProgress("正在签名交易...", 90);
            let signature = await wallet.signTransaction(txBytes);
            notifyProgress("正在提交交易到区块链...", 95);
            let txResult = await suiClient.executeTransactionBlock({
                transactionBlock: txBytes,
                signature: signature,
            });
            
            notifyProgress("上传完成!", 100);
            
            const confirmModal = new VaultSyncModal(
                app, 
                "同步数据成功", 
                `数据已成功同步至链上\n交易ID: ${txResult.digest}`
            );
            confirmModal.open();
        } catch (e) {
            notifyProgress("发布数据上链异常，请查看控制台获取详情", 0);
            console.log("交易构建错误:", e);
            throw e;
        }
        
        console.log("推送完成");
    }
}

export async function pullFromChain(
    vault: Vault, 
    vaultLocalPath: string, 
    allMarkdownFiles: TFile[], 
    wallet: MnemonicWallet, 
    adapter: DataAdapter,
    notifyProgress?: (message: string, progress?: number) => void,
    app?: App
) {
    // 下载，先获取到vault的名称，去链上找该钱包是否有该vault
    // 有，判断是否有更新
    const vaultId = vault.id;
    const props = {
        vaultId: vaultId,
        moduleName: 'coral_sync',
        wallet: wallet,
        packageId: PACKAGE_ID,
    };

    const { downloadFile, downloadFileContent } = SealUtil(props);

    const stack: Array<{ dir: VaultDir, visited: boolean }> = [];
    stack.push({ dir: vault, visited: false });
    const path_join: string[] = [];
    
    // 计算总文件数
    const countFiles = (dir: VaultDir): number => {
        let count = dir.files.length;
        dir.directories.forEach(subDir => {
            count += countFiles(subDir);
        });
        return count;
    };
    
    const totalFiles = countFiles(vault);
    let processedFiles = 0;
    
    if (notifyProgress) {
        notifyProgress(`准备下载 ${totalFiles} 个文件...`, 0);
    }
    
    while (stack.length > 0) {
        const entry = stack.pop();
        const currVault = entry?.dir;
        
        if (currVault) {
            if (!entry?.visited) {
                // 首次访问：构建路径并处理文件
                if (currVault !== vault) {
                    path_join.push(currVault.name);
                }
                const cur_dir_path = [...path_join].join('/');
                const dir_exists = await adapter.exists(cur_dir_path, true);
                
                if (!dir_exists) {
                    // 目录不存在，创建目录
                    await adapter.mkdir(cur_dir_path);
                    if (notifyProgress) {
                        notifyProgress(`创建目录: ${cur_dir_path}`, Math.floor((processedFiles / totalFiles) * 100));
                    }
                }
                
                // 处理当前目录文件
                for (const file of currVault.files) {
                    const cur_path = [...path_join, file.title].join('/');
                    const exists = await adapter.exists(cur_path, true);
                    
                    if (notifyProgress) {
                        notifyProgress(`正在处理: ${file.title} (${processedFiles + 1}/${totalFiles})`, Math.floor((processedFiles / totalFiles) * 100));
                    }
                    
                    if (!exists) {
                        // 文件不存在，直接下载
                        console.log("下载新文件", file.title);
                        await downloadFile(file, cur_path, adapter);
                        processedFiles++;
                    } else {
                        // 文件存在，比较差异
                        console.log("检查文件差异", file.title);
                        
                        // 读取本地文件内容
                        const localContent = await adapter.read(cur_path);
                        
                        // 获取链上文件内容
                        const remoteContent = await downloadFileContent(file);
                        
                        // 比较内容
                        if (localContent !== remoteContent) {
                            console.log("文件内容不同，显示差异", file.title);
                            
                            if (app) {
                                // 显示差异对话框
                                await new Promise<void>((resolve) => {
                                    const diffModal = new DiffModal(
                                        app,
                                        file.title,
                                        localContent,
                                        remoteContent,
                                        async (content?: string) => {
                                            // 用户选择更新（可能是链上版本或手动编辑的版本）
                                            const finalContent = content || remoteContent;
                                            console.log("用户选择更新文件", file.title);
                                            await adapter.write(cur_path, finalContent);
                                            resolve();
                                        },
                                        () => {
                                            // 用户选择跳过
                                            console.log("用户选择跳过文件", file.title);
                                            resolve();
                                        }
                                    );
                                    diffModal.open();
                                });
                            } else {
                                // 如果没有app实例，直接覆盖
                                await adapter.write(cur_path, remoteContent);
                            }
                        } else {
                            console.log("文件内容相同，跳过", file.title);
                        }
                        processedFiles++;
                    }
                    
                    if (notifyProgress) {
                        const progress = Math.floor((processedFiles / totalFiles) * 100);
                        notifyProgress(`已处理 ${file.title} (${processedFiles}/${totalFiles})`, progress);
                    }
                }
                
                // 将当前目录标记为已访问，准备后续弹出路径
                stack.push({ dir: currVault, visited: true });

                // 逆向插入子目录保证处理顺序
                for (let i = currVault.directories.length - 1; i >= 0; i--) {
                    stack.push({ dir: currVault.directories[i], visited: false });
                }
            } else {
                // 二次访问：弹出目录路径
                if (currVault !== vault) {
                    path_join.pop();
                }
            }
        }
    }
}

function flattenVaultFilesOptimized(vault: Vault): Map<string, File> {
    const fileMap = new Map();
    const pathSegments: string[] = [];

    function processDir(dir: VaultDir) {
        pathSegments.push(dir.name);

        // 处理文件
        dir.files.forEach(file => {
            pathSegments.push(file.title + ".md");
            const fullPath = pathSegments.join('/');
            fileMap.set(fullPath, file);
            pathSegments.pop();
        });

        // 处理子目录
        dir.directories.forEach(subDir => {
            processDir(subDir);
        });

        pathSegments.pop();
    }

    // 处理根文件
    vault.files.forEach(file => {
        pathSegments.push(file.title + ".md");
        fileMap.set(pathSegments.join('/'), file);
        pathSegments.pop();
    });

    // 处理目录
    vault.directories.forEach(dir => processDir(dir));

    return fileMap;
}
