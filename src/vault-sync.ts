import { App, DataAdapter, TFile, normalizePath } from 'obsidian';
import { getVaultByAddress, Vault, VaultDir } from './server/vault-server';
import { MnemonicWallet } from './mnemonic-wallet';
import { Transaction } from '@mysten/sui/transactions';
import { PACKAGE_ID, NET_WORK } from './constant';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { SealUtil } from './utils/sealUtil';
import { VaultSyncModal } from './components/modal';

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
            module: 'perlite_sync',
            function: 'new_root_directory',
            arguments: [tx.pure.string(vaultName), tx.object("0x6")],
        });
        
        tx.moveCall({
            package: PACKAGE_ID,
            module: 'perlite_sync',
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
    notifyProgress: (message: string) => void, 
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
            moduleName: 'perlite_sync',
            wallet: wallet,
            packageId: PACKAGE_ID,
        };
        const { handleSubmit } = SealUtil(props);

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
                    notifyProgress(`处理目录: ${tempPath}`);
                    let par = tx.moveCall({
                        package: PACKAGE_ID,
                        module: 'perlite_sync',
                        function: 'new_directory',
                        arguments: [tx.pure.string(currDir), tx.object(parent), tx.object("0x6")],
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
                notifyProgress(`处理文件: ${fileName}`);
                
                const result = await handleSubmit(new File([data], fileName, {
                    type: 'text/plain',
                    lastModified: Date.now()
                }), epoch);
                
                if (result) {
                    notifyProgress(`文件: ${fileName} 已保存至Walrus`);
                    let fileResult = tx.moveCall({
                        target: PACKAGE_ID + '::perlite_sync::new_file',
                        arguments: [tx.pure.string(fileName), tx.pure.string(result.blobId), tx.pure.u64(result.endEpoch), tx.object(parent_dir), tx.object("0x6")],
                    });
                    waitTransferFiles.push(fileResult);
                }
            }
        }
        
        // 处理目录
        waitTransferDirs.forEach(dir => {
            tx.moveCall({
                package: PACKAGE_ID,
                module: 'perlite_sync',
                function: 'transfer_dir',
                arguments: [tx.object(dir), tx.pure.address(address)],
            });
        });
        
        // 处理文件
        waitTransferFiles.forEach(file => {
            tx.moveCall({
                package: PACKAGE_ID,
                module: 'perlite_sync',
                function: 'transfer_file',
                arguments: [tx.object(file), tx.pure.address(address)],
            });
        });
        
        notifyProgress("正在同步数据至链上，请稍后...");
        const suiClient = new SuiClient({ url: getFullnodeUrl(NET_WORK) });
        
        try {
            let txBytes = await tx.build({ client: suiClient });
            let signature = await wallet.signTransaction(txBytes);
            let txResult = await suiClient.executeTransactionBlock({
                transactionBlock: txBytes,
                signature: signature,
            });
            
            const confirmModal = new VaultSyncModal(
                app, 
                "同步数据成功", 
                `数据已成功同步至链上\n交易ID: ${txResult.digest}`
            );
            confirmModal.open();
        } catch (e) {
            notifyProgress("发布数据上链异常，请查看控制台获取详情");
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
    adapter: DataAdapter
) {
    // 下载，先获取到vault的名称，去链上找该钱包是否有该vault
    // 有，判断是否有更新
    const vaultId = vault.id;
    const props = {
        vaultId: vaultId,
        moduleName: 'perlite_sync',
        wallet: wallet,
        packageId: PACKAGE_ID,
    };

    const { downloadFile } = SealUtil(props);

    const stack: Array<{ dir: VaultDir, visited: boolean }> = [];
    stack.push({ dir: vault, visited: false });
    const path_join: string[] = [];
    
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
                }
                
                // 处理当前目录文件
                for (const file of currVault.files) {
                    const cur_path = [...path_join, file.title].join('/');
                    const exists = await adapter.exists(cur_path, true);
                    
                    if (!exists) {
                        // 下载文件
                        console.log("下载文件", file.title);
                        await downloadFile(file, cur_path, adapter);
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
