import jDataview from 'jdataview';

interface TFileEntry {
    type: number;
    offset: number;
    realSize: number;
    compressedSize: number;
    lengthAligned: number;
}
declare abstract class GrfBase<T> {
    private fd;
    version: number;
    fileCount: number;
    loaded: boolean;
    files: Map<string, TFileEntry>;
    private fileTableOffset;
    constructor(fd: T);
    abstract getStreamBuffer(fd: T, offset: number, length: number): Promise<Uint8Array>;
    getStreamReader(offset: number, length: number): Promise<jDataview>;
    load(): Promise<void>;
    private parseHeader;
    private parseFileList;
    private decodeEntry;
    getFile(filename: string): Promise<{
        data: null | Uint8Array;
        error: null | string;
    }>;
}

/**
 * Using this Browser, we work from a File or Blob object.
 * We are use the FileReader API to read only some part of the file to avoid
 * loading 2 gigas into memory
 */
declare class GrfBrowser extends GrfBase<File | Blob> {
    getStreamBuffer(buffer: File | Blob, offset: number, length: number): Promise<Uint8Array>;
}

declare class GrfNode extends GrfBase<number> {
    constructor(fd: number);
    getStreamBuffer(fd: number, offset: number, length: number): Promise<Uint8Array>;
}

export { GrfBrowser, GrfNode, type TFileEntry };
