import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { bcs } from '@mysten/sui/bcs';
import { toBase64 } from '@mysten/sui/utils';
import { messageWithIntent, toSerializedSignature } from '@mysten/sui/cryptography'
import { blake2b } from '@noble/hashes/blake2b';

interface MnemonicWalletInterface {
    mnemonic: string;
    address: string;
    privateKey: string;
    publicKey: string;
    keypair: Ed25519Keypair;
}

export class MnemonicWallet implements MnemonicWalletInterface {
    mnemonic: string;
    address: string;
    privateKey: string;
    publicKey: string;
    keypair: Ed25519Keypair;
    
    constructor(mnemonic: string) {
        this.mnemonic = mnemonic;
        // 生成密钥对
        const keypair = Ed25519Keypair.deriveKeypair(mnemonic);
        this.keypair = keypair;
        // 获取私钥
        const privateKey = keypair.getSecretKey();
        // 获取公钥
        const publicKey = keypair.getPublicKey();
        this.address = publicKey.toSuiAddress();
        this.privateKey = privateKey;
        this.publicKey = toBase64(publicKey.toRawBytes());
    }

    public getAddress(): string {
        return this.address;
    }

    public async signPersonalMessage(message: Uint8Array): Promise<string> {
        let intent = messageWithIntent('PersonalMessage', bcs.vector(bcs.u8()).serialize(message).toBytes());
        const signature = await this.generateSignature(intent, this.keypair);
        return signature;
    }

    public async signTransaction(message: Uint8Array): Promise<string> {   
        let intent = messageWithIntent('TransactionData', message);
        const signature = await this.generateSignature(intent, this.keypair);
        return signature;
    }

    protected async generateSignature(data: Uint8Array, keyPair: Ed25519Keypair) {
        const digest = blake2b(data, { dkLen: 32 });
        const pubkey = keyPair.getPublicKey();
        const signature = await keyPair.sign(digest);
        const signatureScheme = keyPair.getKeyScheme();
        return toSerializedSignature({
            signature,
            signatureScheme,
            publicKey: pubkey,
        });
    }

    public destroy(): void {
        this.mnemonic = '';
        this.address = '';
        this.privateKey = '';
        this.publicKey = '';
        this.keypair = new Ed25519Keypair();
    }
}
