declare module 'bam' {
  export class Utils {
    constructor();
    static numberReader(type: string, ba: Uint8Array , offset: number): number;
    static urlFetchableFactory(url: string, start: number, end: number, opts: any): URLFetchable;
    static blobFetchableFactory(blob: Blob): BlobFetchable
  }

  export class URLFetchable {
    constructor(url: string, start: number, end: number, opts: any);
    slice(s: number, l: number): URLFetchable;
    fetchAsText(callback: any): any;
    salted(): URLFetchable;
    fetch(callback: any, opts: any): any;
  }

  export class BlobFetchable {
    constructor(blob: Blob);
    slice(start: number, length: number): BlobFetchable;
    salted(): BlobFetchable;
    fetch(callback: any): void;
  }

  export class BamFile{
    constructor();

    static factory(data: any, bai: any, indexChunks: any, callback: any, attempted: any): BamFile;
    blocksForRange(refId: number, min: number, max: number): Chunk[];
    fetch(chr: string, min: number, max: number, callback: any, opts: any): any;
    readBamRecords(ba: Uint8Array, offset: number, sink: BamRecord[], min: number, max: number, chrId: number, opts: any): boolean;
  }

  export class BamRecord{
    constructor();
  }

  export class Chunk {
    constructor(minv: Vob, maxv: Vob);
  }

  export class Vob {
    constructor(b: number, o: number);
    toString(): string;
    static factory(ba: Uint8Array, offset: number): Vob;
  }
}

  