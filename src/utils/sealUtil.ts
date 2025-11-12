import { EncryptedObject, NoAccessError, SealClient, SessionKey } from '@mysten/seal';
import { fromHex, toHex } from '@mysten/sui/utils';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { MnemonicWallet } from '../mnemonic-wallet';
import { DataAdapter } from 'obsidian';
import { PACKAGE_ID } from '../constant';
import { File as VaultFile } from '../server/vault-server';

type WalrusService = {
    id: string;
    name: string;
    publisherUrl: string;
    aggregatorUrl: string;
};

export type MoveCallConstructor = (tx: Transaction, id: string) => void;

export type UploadResult = {
    status: string;
    blobId: string;
    endEpoch: number;
    suiRefType: string;
    suiRef: string;
    suiBaseUrl: string;
    blobUrl: string;
    suiUrl: string;
    isImage: string;
};

interface WalrusUploadProps {
    vaultId: string;
    moduleName: string;
    packageId: string;
    wallet: MnemonicWallet;
}

export function SealUtil({ vaultId, moduleName, packageId, wallet}: WalrusUploadProps) {
    const SUI_VIEW_TX_URL = `https://suiscan.xyz/testnet/tx`;
    const SUI_VIEW_OBJECT_URL = `https://suiscan.xyz/testnet/object`;

    const handleSubmit = async (file: File, epoch: number): Promise<UploadResult> => {
        if (!file) {
            throw new Error('未选择文件');
        }

        const reader = new FileReader();
        return new Promise((resolve, reject) => {
            reader.onload = async (event) => {
                try {
                    if (!event.target?.result || !(event.target.result instanceof ArrayBuffer)) {
                        throw new Error('文件数据无效');
                    }
                    
                    const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
                    // 使用类型断言解决版本不兼容问题
                    const serverObjectIds = ["0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8"];
                    const client = new SealClient({
                      suiClient,
                      serverConfigs: serverObjectIds.map((id) => ({
                        objectId: id,
                        weight: 1,
                      })),
                      verifyKeyServers: false,
                    });
                    
                    const nonce = crypto.getRandomValues(new Uint8Array(5));
                    const policyObjectBytes = fromHex(vaultId);
                    const id = toHex(new Uint8Array([...policyObjectBytes, ...nonce]));
                    
                    const { encryptedObject: encryptedBytes } = await client.encrypt({
                        threshold: 2,
                        packageId,
                        id,
                        data: new Uint8Array(event.target.result),
                    });
                    
                    const storageInfo = await storeBlob(encryptedBytes, epoch);
                    if(storageInfo) {
                        resolve(displayUpload(storageInfo.info, file.type));
                    } else {
                        reject(new Error('存储数据到Walrus失败'));
                    }
                } catch (error) {
                    reject(error);
                }
            };
            reader.readAsArrayBuffer(file);
        });
    };

    const storeBlob = async(encryptedData: Uint8Array, epoch: number) => {
        try {
            console.log("尝试在Walrus服务器存储数据");
            let urls = [
                "https://publisher.walrus-testnet.walrus.space",
                "https://wal-publisher-testnet.staketab.org",
                "https://walrus-testnet-publisher.bartestnet.com",
                "https://walrus-testnet-publisher.nodes.guru",
                "https://sui-walrus-testnet.bwarelabs.com/publisher",
                "https://walrus-testnet-publisher.stakin-nodes.com",
                "https://testnet-publisher-walrus.kiliglab.io",
                "https://walrus-testnet-publisher.nodeinfra.com",
                "https://walrus-testnet.blockscope.net:11444",
                "https://walrus-publish-testnet.chainode.tech:9003",
                "https://walrus-testnet-publisher.starduststaking.com:11445",
                "http://walrus-publisher-testnet.overclock.run:9001",
                "http://walrus-testnet-publisher.everstake.one:9001",
                "http://walrus.testnet.pops.one:9001",
                "http://ivory-dakar-e5812.walrus.bdnodes.net:9001",
                "http://publisher.testnet.sui.rpcpool.com:9001",
                "http://walrus.krates.ai:9001",
                "http://walrus-publisher-testnet.latitude-sui.com:9001",
                "http://walrus-tn.juicystake.io:9090",
                "http://walrus-testnet.stakingdefenseleague.com:9001",
                "http://walrus.sui.thepassivetrust.com:9001",
            ];
            // 使用 getPublisherUrl 来构建URL
            //const url = getPublisherUrl(`/v1/blobs?epochs=${epoch}`);
            for (let url of urls) {
                try {
                    console.log("尝试服务器存储数据:", url);
                    const response = await fetch(url + "/v1/blobs?epochs=" + epoch, {
                        method: 'PUT',
                        body: new Blob([encryptedData as BlobPart]), // 将 Uint8Array 包装在 Blob 中
                    });
                    
                    if (response.status === 200) {
                        const info = await response.json();
                        return { info };
                    }
                } catch(e) {
                    console.error("服务器存储失败，尝试下一个URL", e);
                }
            }
        } catch(e) {
            console.error("在Walrus上发布数据时出错：", e);
            
            // 如果第一个服务失败，尝试备用服务列表
            
            

        }
        // 如果所有服务器都尝试失败，返回null
        return null;
    };

    const displayUpload = (storage_info: any, media_type: any): UploadResult => {
        let info: UploadResult;
        
        if ('alreadyCertified' in storage_info) {
            info = {
                status: 'Already certified',
                blobId: storage_info.alreadyCertified.blobId,
                endEpoch: storage_info.alreadyCertified.endEpoch,
                suiRefType: 'Previous Sui Certified Event',
                suiRef: storage_info.alreadyCertified.event.txDigest,
                suiBaseUrl: SUI_VIEW_TX_URL,
                blobUrl: `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${storage_info.alreadyCertified.blobId}`,
                suiUrl: `${SUI_VIEW_OBJECT_URL}/${storage_info.alreadyCertified.event.txDigest}`,
                isImage: media_type.startsWith('image'),
            };
        } else if ('newlyCreated' in storage_info) {
            info = {
                status: 'Newly created',
                blobId: storage_info.newlyCreated.blobObject.blobId,
                endEpoch: storage_info.newlyCreated.blobObject.storage.endEpoch,
                suiRefType: 'Associated Sui Object',
                suiRef: storage_info.newlyCreated.blobObject.id,
                suiBaseUrl: SUI_VIEW_OBJECT_URL,
                blobUrl: `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${storage_info.newlyCreated.blobObject.blobId}`,
                suiUrl: `${SUI_VIEW_OBJECT_URL}/${storage_info.newlyCreated.blobObject.id}`,
                isImage: media_type.startsWith('image'),
            };
        } else {
            throw Error('未处理的成功响应!');
        }
        
        console.log("上传结果:", info);
        return info;
    };

    async function handlePublish(title: string, end_epoch: number, parent_dir: string | any, blob_id: string) {
        const tx = new Transaction();
        tx.setSender(wallet.getAddress());
        
        // 判断 parent_dir 是字符串ID还是交易中的对象引用
        let parentDirArg = typeof parent_dir === 'string' ? tx.object(parent_dir) : parent_dir;
        let fileResult = tx.moveCall({
            target: PACKAGE_ID+'::coral_sync::new_file',
            arguments: [tx.pure.string(title), tx.pure.string(blob_id), tx.pure.u64(end_epoch), parentDirArg, tx.object("0x6")],
        });

        tx.moveCall({
            target: `${PACKAGE_ID}::coral_sync::transfer_file`,
            arguments: [tx.object(fileResult), tx.pure.address(wallet.getAddress())],
        });
        
        tx.setGasBudget(10000000);
        const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
        
        try {
            (async () => {
                let txBytes = await tx.build({ client: suiClient });
                let signature = await wallet.signTransaction(txBytes);

                let txResult = await suiClient.executeTransactionBlock({
                    transactionBlock: txBytes,
                    signature: signature,
                });
                
                console.log("发布文件交易结果:", txResult);
            })();
        } catch (e) {
            console.log("交易构建错误:", e);
        }
    }

    async function downloadFile(file: VaultFile, filePath: string, adapter: DataAdapter) {
        const TTL_MIN = 10;
        const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
        const serverObjectIds = ["0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8"];
        const sessionKey = await SessionKey.create({
            address: wallet.getAddress(),
            packageId,
            ttlMin: TTL_MIN,
            suiClient,
        });

        try {
            const client = new SealClient({
                suiClient: suiClient,
                serverConfigs: serverObjectIds.map((id) => ({
                    objectId: id,
                    weight: 1,
                  })),
                verifyKeyServers: false,
            });
            
            let message = sessionKey.getPersonalMessage();
            let signature = await wallet.signPersonalMessage(message);
            const moveCallConstructor = await constructMoveCall(packageId, file.id);

            await sessionKey.setPersonalMessageSignature(signature);
            const blobs = await downloadAndDecrypt(
                adapter,
                [file.blob_id],
                sessionKey,
                suiClient,
                client,
                moveCallConstructor
            );
            
            for(let i=0; i<blobs.length; i++) {
                const blob = blobs[i];
                await saveToLocal(adapter, blob, filePath);
            }
        } catch (error: any) {
            console.error('错误:', error);
        }
    }

    async function downloadAndDecrypt(
        adapter: DataAdapter,
        blobIds: string[],
        sessionKey: SessionKey,
        suiClient: SuiClient,
        sealClient: SealClient,
        moveCallConstructor: (tx: Transaction, id: string) => void,
    ): Promise<Blob[]> {
        const aggregators = [
            'https://aggregator.walrus-testnet.walrus.space',
            'https://wal-aggregator-testnet.staketab.org',
            'https://walrus-testnet-aggregator.bartestnet.com', 
            'https://walrus-testnet.blockscope.net', 
            'https://walrus-testnet-aggregator.nodes.guru', 
            'https://walrus-cache-testnet.overclock.run',
            'https://sui-walrus-testnet.bwarelabs.com/aggregator',
            'https://walrus-testnet-aggregator.stakin-nodes.com',
            'https://testnet-aggregator-walrus.kiliglab.io',
            'https://walrus-cache-testnet.latitude-sui.com',
            'https://walrus-testnet-aggregator.nodeinfra.com',
            'https://walrus-tn.juicystake.io:9443',
            'https://walrus-agg-testnet.chainode.tech:9002',
            'https://walrus-testnet-aggregator.starduststaking.com:11444',
            'http://walrus-testnet-aggregator.everstake.one:9000',
            'http://walrus.testnet.pops.one:9000',
            'http://scarlet-brussels-376c2.walrus.bdnodes.net:9000',
            'http://aggregator.testnet.sui.rpcpool.com:9000',
            'http://walrus.krates.ai:9000',
            'http://walrus-testnet.stakingdefenseleague.com:9000',
            'http://walrus.sui.thepassivetrust.com:9000'
        ];
        
        // 并行下载所有文件（忽略错误）
        const blobs: Blob[] = [];

        const downloadResults = await Promise.all(
            blobIds.map(async (blobId) => {
                for (let aggregator of aggregators) {
                    try {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 10000);
                        const aggregatorUrl = `${aggregator}/v1/blobs/${blobId}`;
                        const response = await fetch(aggregatorUrl, { signal: controller.signal });
                        clearTimeout(timeout);
                        
                        if (!response.ok) {
                            continue;
                        }
                        return await response.arrayBuffer();
                    } catch (err) {
                        console.error(`无法从Walrus检索Blob ${blobId}`, err);
                        continue;
                    }
                }
                return null;
            }),
        );

        // 过滤掉下载失败的内容
        const validDownloads = downloadResults.filter((result): result is ArrayBuffer => result !== null);
        console.log('有效下载数量:', validDownloads.length);
        console.log('有效下载:', validDownloads);

        if (validDownloads.length === 0) {
            const errorMsg = '无法从此Walrus聚合器检索文件，请重试（将使用随机选择的聚合器）。上传超过1个epoch的文件已从Walrus中删除。';
            console.error(errorMsg);
            return blobs;
        }

        // 批量获取密钥（每批<=10）
        for (let i = 0; i < validDownloads.length; i += 10) {
            const batch = validDownloads.slice(i, i + 10);
            const ids = batch.map((enc) => EncryptedObject.parse(new Uint8Array(enc)).id);
            const tx = new Transaction();
            ids.forEach((id) => moveCallConstructor(tx, id));
            const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
            
            try {
                await sealClient.fetchKeys({ ids, txBytes, sessionKey, threshold: 2 });
            } catch (err) {
                console.log(err);
                const errorMsg =
                    err instanceof NoAccessError
                        ? '无权访问解密密钥'
                        : '无法解密文件，请重试';
                console.error(errorMsg, err);
                return blobs;
            }
        }

        // 顺序解密文件
        for (const encryptedData of validDownloads) {
            const fullId = EncryptedObject.parse(new Uint8Array(encryptedData)).id;
            const tx = new Transaction();
            moveCallConstructor(tx, fullId);
            const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
            
            try {
                // 注意，所有密钥都在上面获取，所以这里只进行本地解密
                const decryptedFile = await sealClient.decrypt({
                    data: new Uint8Array(encryptedData),
                    sessionKey,
                    txBytes,
                });
                
                // 将解密后的文件内容转换为文本
                const blob = new Blob([decryptedFile as BlobPart], { type: 'text/markdown' });
                console.log('文件内容:', blob);
                blobs.push(blob);
            } catch (err) {
                console.log(err);
                const errorMsg =
                    err instanceof NoAccessError
                        ? '无权访问解密密钥'
                        : '无法解密文件，请重试';
                console.error(errorMsg, err);
                return blobs;
            }
        }
        return blobs;
    };

    function constructMoveCall(packageId: string, fileId: string): MoveCallConstructor {
        return (tx: Transaction, id: string) => {
            tx.moveCall({
                target: PACKAGE_ID+`::coral_sync::seal_approve`,
                arguments: [tx.pure.vector('u8', fromHex(id)), tx.object(fileId)],
            });
        };
    }

    async function saveToLocal(adapter: DataAdapter, blob: Blob, filePath: string) {
        try {
            const arrayBuffer = await blob.arrayBuffer();
            adapter.writeBinary(filePath, arrayBuffer);
            console.log(`文件已保存到: ${filePath}`);
        } catch (error) {
            console.error('保存文件失败:', error);
            throw error;
        }
    };
    
    async function downloadFileContent(file: VaultFile): Promise<string> {
        const TTL_MIN = 10;
        const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
        const serverObjectIds = ["0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8"];
        const sessionKey = await SessionKey.create({
            address: wallet.getAddress(),
            packageId,
            ttlMin: TTL_MIN,
            suiClient,
        });

        try {
            const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
            const client = new SealClient({
                suiClient: suiClient as any,
                serverConfigs: serverObjectIds.map((id) => ({
                    objectId: id,
                    weight: 1,
                  })),
                verifyKeyServers: false,
            });
            
            let message = sessionKey.getPersonalMessage();
            let signature = await wallet.signPersonalMessage(message);
            const moveCallConstructor = await constructMoveCall(packageId, file.id);

            await sessionKey.setPersonalMessageSignature(signature);
            const blobs = await downloadAndDecrypt(
                null as any, // adapter不需要用于此方法
                [file.blob_id],
                sessionKey,
                suiClient,
                client,
                moveCallConstructor
            );
            
            if (blobs.length === 0) {
                throw new Error('下载文件内容失败');
            }
            
            // 将Blob转换为文本
            const blob = blobs[0];
            const text = await blob.text();
            return text;
        } catch (error: any) {
            console.error('下载文件内容错误:', error);
            throw error;
        }
    }
    
    return {
        handleSubmit,
        displayUpload,
        downloadFile,
        downloadFileContent,
        handlePublish: (title: string, end_epoch: number, parent_dir: string, blob_id: string) => 
            handlePublish(title, end_epoch, parent_dir, blob_id)
    };
}
