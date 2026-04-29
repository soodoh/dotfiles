export interface FileHash {
	hashFile(path: string): Promise<string>;
}