import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { graphql } from '@mysten/sui/graphql/schemas/latest';
import { PACKAGE_ID, GRAPHQL_URL } from '../constant';

export type Directory = {
    id: string;
    name: string;
    parent: string;
    is_root: boolean;
    created_at: Date;
    updated_at: Date;
}

export type VaultDir = {
    id: string;
    name: string;
    directories: Array<VaultDir>;
    files: Array<File>;
    created_at: Date;
    updated_at: Date;
}

export type Vault = {
    id: string;
    name: string;
    directories: Array<VaultDir>;
    files: Array<File>;
    created_at: Date;
    updated_at: Date;
}

export type File = {
    id: string;
    title: string;
    belong_dir: string;
    blob_id: string;
    end_epoch: number;
    created_at: Date;
    updated_at: Date;
}

const queryByAddressAndType = graphql(`
    query($address: SuiAddress!, $type: String!, $cursor: String) {
      address(address: $address) {
        objects(filter: { type: $type } first: 50 after: $cursor) {
          edges {
            node {
              contents {
                json
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
`);

export async function getVaultByAddress(address: string, vaultName: string, packageId: string = PACKAGE_ID): Promise<Vault | undefined> {
    console.log("getVaultByAddress 使用 packageId:", packageId);
    let dirs = await getUserOwnDirectory(address, GRAPHQL_URL, packageId);
    console.log("getUserOwnDirectory dirs:", dirs);
    if (dirs.length === 0) {
        return undefined;
    }
    
    let files = await getUserOwnFile(address, GRAPHQL_URL, packageId);
    const dirMap = new Map<string, Directory>();
    const parentMap = new Map<string, Directory[]>();
    const fileMap = new Map<string, File[]>();
    
    // 处理目录
    dirs.forEach(dir => {
        dirMap.set(dir.id, dir);
        
        if (!parentMap.has(dir.parent)) {
            parentMap.set(dir.parent, []);
        }
        parentMap.get(dir.parent)!.push(dir);
    });

    // 处理文件
    files.forEach(file => {
        if (!fileMap.has(file.belong_dir)) {
            fileMap.set(file.belong_dir, []);
        }
        fileMap.get(file.belong_dir)!.push(file);
    });

    // 递归构建目录结构
    const buildDirectory = (dirId: string): VaultDir => {
        const dir = dirMap.get(dirId)!;
        
        // 获取子目录（已排序）
        const childDirs = (parentMap.get(dirId) || [])
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(d => buildDirectory(d.id));

        // 获取文件（已排序）
        const files = (fileMap.get(dirId) || [])
            .sort((a, b) => a.title.localeCompare(b.title));

        return {
            ...dir,
            directories: childDirs,
            files,
        };
    };

    // 构建根目录
    const rootDir = dirs.find(d => d.is_root && d.name === vaultName);
    if (!rootDir) {
        return undefined;
    }
    
    const dir = buildDirectory(rootDir.id);
    if (dir) {
        return {
            id: dir.id,
            name: dir.name,
            directories: dir.directories,
            files: dir.files,
            created_at: rootDir.created_at,
            updated_at: rootDir.updated_at,
        };
    } else {
        return undefined;
    }
}

async function getUserOwnDirectory(address: string, graphqlUrl: string, packageId: string = PACKAGE_ID): Promise<Array<Directory>> {
    const suiGraphQLClient = new SuiGraphQLClient({ url: graphqlUrl });
    const type = packageId + "::coral_sync::Directory";
    console.log("查询目录:", type, "使用 packageId:", packageId);
    
    let endCursor: string | null | undefined = null;
    const result: Directory[] = [];

    const parseDirData = (data: any) => {
        return data?.address?.objects?.edges.map((edge: any) => {
            const json = edge.node.contents?.json;
            return {
                id: json.id,
                name: json.name,
                parent: json.parent,
                is_root: json.is_root,
                created_at: new Date(json.created_at),
                updated_at: new Date(json.updated_at),
            } as Directory;
        }) || [];
    };

    let hasNextPage = false;
    do {
        const currentPage: any = await suiGraphQLClient.query({
            query: queryByAddressAndType,
            variables: { address, type, cursor: endCursor }
        });
        result.push(...parseDirData(currentPage.data));

        endCursor = currentPage.data?.address?.objects?.pageInfo?.endCursor;
        hasNextPage = currentPage.data?.address?.objects?.pageInfo?.hasNextPage;
    } while (hasNextPage);
    
    return result;
}

async function getUserOwnFile(address: string, graphqlUrl: string, packageId: string = PACKAGE_ID): Promise<Array<File>> {
    const suiGraphQLClient = new SuiGraphQLClient({ url: graphqlUrl });
    const type = packageId + "::coral_sync::File";
    console.log("查询文件:", type, "使用 packageId:", packageId);
    
    let endCursor: string | null | undefined = null;
    const result: File[] = [];

    const parseFileData = (data: any) => {
        return data?.address?.objects?.edges.map((edge: any) => {
            const json = edge.node.contents?.json;
            return {
                id: json.id,
                title: json.title,
                belong_dir: json.belong_dir,
                blob_id: json.blob_id,
                end_epoch: json.end_epoch,
                created_at: new Date(json.created_at),
                updated_at: new Date(json.updated_at)
            } as File;
        }) || [];
    };
    
    let hasNextPage = false;
    do {
        const currentPage: any = await suiGraphQLClient.query({
            query: queryByAddressAndType,
            variables: { address, type, cursor: endCursor }
        });

        result.push(...parseFileData(currentPage.data));

        endCursor = currentPage.data?.address?.objects?.pageInfo?.endCursor;
        hasNextPage = currentPage.data?.address?.objects?.pageInfo?.hasNextPage;
    } while (hasNextPage);

    return result;
}
