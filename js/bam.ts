import Vob from './vob';//methods: readVob
import BGZF from './bgzf';
import { NumberReader } from './bin';//methods: readInt
import Chunk from './chunk';
import BamRecord from './bam-record';

export default class BamFile {
  indexToChr: string[];
  chrToIndex: { [key: string]: number };
  indices: Uint8Array[];
  indexChunks: any;
  bai: any;
  data: any;
  static readonly BAM_MAGIC = 0x14d4142;
  static readonly BAI_MAGIC = 0x1494142;
  static readonly BamFlags: {[key: string]: number} = {
    MULTIPLE_SEGMENTS:       0x1,
    ALL_SEGMENTS_ALIGN:      0x2,
    SEGMENT_UNMAPPED:        0x4,
    NEXT_SEGMENT_UNMAPPED:   0x8,
    REVERSE_COMPLEMENT:      0x10,
    NEXT_REVERSE_COMPLEMENT: 0x20,
    FIRST_SEGMENT:           0x40,
    LAST_SEGMENT:            0x80,
    SECONDARY_ALIGNMENT:     0x100,
    QC_FAIL:                 0x200,
    DUPLICATE:               0x400,
    SUPPLEMENTARY:           0x800
  };
  private static readonly SEQRET_DECODER = ['=', 'A', 'C', 'x', 'G', 'x', 'x', 'x', 'T', 'x', 'x', 'x', 'x', 'x', 'x', 'N'];
  private static readonly CIGAR_DECODER = ['M', 'I', 'D', 'N', 'S', 'H', 'P', '=', 'X', '?', '?', '?', '?', '?', '?', '?'];

  static factory(data: any, bai: any, indexChunks: any, callback: any, attempted: any): BamFile {
    const bam = new BamFile();
    bam.data = data;
    bam.bai = bai;
    bam.indexChunks = indexChunks;

    let minBlockIndex = bam.indexChunks ? bam.indexChunks.minBlockIndex : 1000000000;

    // Fills out bam.chrToIndex and bam.indexToChr based on the first few bytes of the BAM.
    const parseBamHeader = (r: ArrayBuffer) => {
      if (!r) {
        return callback(null, "Couldn't access BAM");
      }

      const unc = BGZF.unzip(r, r.byteLength);
      const uncba = new Uint8Array(unc);

      const magic = NumberReader.readInt(uncba, 0);
      if (magic != BamFile.BAM_MAGIC) {
        return callback(null, "Not a BAM file, magic=0x" + magic.toString(16));
      }
      let headLen = NumberReader.readInt(uncba, 4);
      let header = '';
      for (let i = 0; i < headLen; ++i) {
        header += String.fromCharCode(uncba[i + 8]);
      }

      const nRef = NumberReader.readInt(uncba, headLen + 8);
      let p = headLen + 12;

      bam.chrToIndex = {};
      bam.indexToChr = [];
      for (let i = 0; i < nRef; ++i) {
        const lName = NumberReader.readInt(uncba, p);
        let name = '';
        for (let j = 0; j < lName - 1; ++j) {
          name += String.fromCharCode(uncba[p + 4 + j]);
        }
        var lRef = NumberReader.readInt(uncba, p + lName + 4);
        bam.chrToIndex[name] = i;
        if (name.indexOf('chr') == 0) {
          bam.chrToIndex[name.substring(3)] = i;
        } else {
          bam.chrToIndex['chr' + name] = i;
        }
        bam.indexToChr.push(name);

        p = p + 8 + lName;
      }

      if (bam.indices) {
        return callback(bam);
      }
    };

    const parseBai = (header: any) => {
      if (!header) {
        return "Couldn't access BAI";
      }
      const uncba = new Uint8Array(header);
      const baiMagic = NumberReader.readInt(uncba, 0);
      if (baiMagic != BamFile.BAI_MAGIC) {
        return callback(null, 'Not a BAI file, magic=0x' + baiMagic.toString(16));
      }
      const nref = NumberReader.readInt(uncba, 4);
      bam.indices = [];
      let p = 8;
      for (let ref = 0; ref < nref; ++ref) {
        const blockStart = p;
        const o = BamFile.getBaiRefLength(uncba, blockStart);
        p += o.length;
        minBlockIndex = Math.min(o.minBlockIndex, minBlockIndex);
        var nbin = o.nbin;
        if (nbin > 0) {
          bam.indices[ref] = new Uint8Array(header, blockStart, p - blockStart);
        }
      }
      return true;
    };

    if (!bam.indexChunks) {
      bam.bai.fetch(function (header: any) {   // Do we really need to fetch the whole thing? :-(
        var result = parseBai(header);
        if (result !== true) {
          if (bam.bai.url && typeof (attempted) === "undefined") {
            // Already attempted x.bam.bai not there so now trying x.bai
            bam.bai.url = bam.data.url.replace(new RegExp('.bam$'), '.bai');

            // True lets us know we are making a second attempt
            return BamFile.factory(data, bam.bai, indexChunks, callback, true);
          }
          else {
            // We've attempted x.bam.bai & x.bai and nothing worked
            callback(null, result);
          }
        } else {
          bam.data.slice(0, minBlockIndex).fetch(parseBamHeader, { timeout: 5000 });
        }
      }, { timeout: 5000 });   // Timeout on first request to catch Chrome mixed-content error.
    } else {
      var chunks = bam.indexChunks.chunks;
      bam.indices = []
      for (var i = 0; i < chunks.length; i++) {
        bam.indices[i] = null;  // To be filled out lazily as needed
      }
      bam.data.slice(0, minBlockIndex).fetch(parseBamHeader);
    }
    return bam;
  }

  private static getBaiRefLength(uncba: Uint8Array, offset: number) {
    let p = offset;
    let nbin = NumberReader.readInt(uncba, p);
    p += 4;
    for (let b = 0; b < nbin; ++b) {
      const bin = NumberReader.readInt(uncba, p);// not used?
      const nchnk = NumberReader.readInt(uncba, p + 4);
      p += 8 + (nchnk * 16);
    }
    const nintv = NumberReader.readInt(uncba, p); p += 4;

    let minBlockIndex = 1000000000;
    let q = p;
    for (let i = 0; i < nintv; ++i) {
      const v = Vob.factory(uncba, q);
      q += 8;
      if (v) {
        var bi = v.block;
        if (v.offset > 0)
          bi += 65536;

        if (bi < minBlockIndex)
          minBlockIndex = bi;
        break;
      }
    }
    p += (nintv * 8);

    return {
      minBlockIndex: minBlockIndex,
      nbin: nbin,
      length: p - offset
    };
  }

  //
  // Binning (transliterated from SAM1.3 spec)
  //

  /* calculate bin given an alignment covering [beg,end) (zero-based, half-close-half-open) */
  private static reg2bin(beg: number, end: number): number {
    --end;
    if (beg >> 14 == end >> 14) return ((1 << 15) - 1) / 7 + (beg >> 14);
    if (beg >> 17 == end >> 17) return ((1 << 12) - 1) / 7 + (beg >> 17);
    if (beg >> 20 == end >> 20) return ((1 << 9) - 1) / 7 + (beg >> 20);
    if (beg >> 23 == end >> 23) return ((1 << 6) - 1) / 7 + (beg >> 23);
    if (beg >> 26 == end >> 26) return ((1 << 3) - 1) / 7 + (beg >> 26);
    return 0;
  }

  /* calculate the list of bins that may overlap with region [beg,end) (zero-based) */
  private static reg2bins(beg: number, end: number): number[] {
    let k: number;
    const list: number[] = [];
    --end;
    list.push(0);
    for (k = 1 + (beg >> 26); k <= 1 + (end >> 26); ++k) list.push(k);
    for (k = 9 + (beg >> 23); k <= 9 + (end >> 23); ++k) list.push(k);
    for (k = 73 + (beg >> 20); k <= 73 + (end >> 20); ++k) list.push(k);
    for (k = 585 + (beg >> 17); k <= 585 + (end >> 17); ++k) list.push(k);
    for (k = 4681 + (beg >> 14); k <= 4681 + (end >> 14); ++k) list.push(k);
    return list;
  }

  constructor() { }

  blocksForRange(refId: number, min: number, max: number) {
    const index: Uint8Array = this.indices[refId];
    if (!index) {
      return [];
    }

    const intBinsL = BamFile.reg2bins(min, max);
    const intBins: boolean[] = [];
    for (var i = 0; i < intBinsL.length; ++i) {
      intBins[intBinsL[i]] = true;
    }
    const leafChunks: Chunk[] = [];
    let otherChunks: Chunk[] = [];

    const nbin = NumberReader.readInt(index, 0);
    let p = 4;
    for (let b = 0; b < nbin; ++b) {
      const bin = NumberReader.readInt(index, p);
      const nchnk = NumberReader.readInt(index, p + 4);
      // dlog('bin=' + bin + '; nchnk=' + nchnk);
      p += 8;
      if (intBins[bin]) {
        for (let c = 0; c < nchnk; ++c) {
          const cs = Vob.factory(index, p);
          const ce = Vob.factory(index, p + 8);
          (bin < 4681 ? otherChunks : leafChunks).push(new Chunk(cs, ce));
          p += 16;
        }
      } else {
        p += (nchnk * 16);
      }
    }
    const nintv = NumberReader.readInt(index, p);
    let lowest: Vob = null;
    const minLin = Math.min(min >> 14, nintv - 1), maxLin = Math.min(max >> 14, nintv - 1);
    for (let i = minLin; i <= maxLin; ++i) {
      const lb = Vob.factory(index, p + 4 + (i * 8));
      if (!lb) {
        continue;
      }
      if (!lowest || lb.block < lowest.block || lb.offset < lowest.offset) {
        lowest = lb;
      }
    }

    const prunedOtherChunks = [];
    if (lowest != null) {
      for (let i = 0; i < otherChunks.length; ++i) {
        const chnk = otherChunks[i];
        if (chnk.maxv.block >= lowest.block && chnk.maxv.offset >= lowest.offset) {
          prunedOtherChunks.push(chnk);
        }
      }
    }
    otherChunks = prunedOtherChunks;
    const intChunks = [];
    for (let i = 0; i < otherChunks.length; ++i) {
      intChunks.push(otherChunks[i]);
    }
    for (let i = 0; i < leafChunks.length; ++i) {
      intChunks.push(leafChunks[i]);
    }

    intChunks.sort((c0: Chunk, c1: Chunk) => {
      const dif = c0.minv.block - c1.minv.block;
      if (dif != 0) {
        return dif;
      } else {
        return c0.minv.offset - c1.minv.offset;
      }
    });

    const mergedChunks: Chunk[] = [];
    if (intChunks.length > 0) {
      let cur = intChunks[0];
      for (let i = 1; i < intChunks.length; ++i) {
        const nc = intChunks[i];
        if (nc.minv.block == cur.maxv.block /* && nc.minv.offset == cur.maxv.offset */) { // no point splitting mid-block
          cur = new Chunk(cur.minv, nc.maxv);
        } else {
          mergedChunks.push(cur);
          cur = nc;
        }
      }
      mergedChunks.push(cur);
    }

    return mergedChunks;
  }

  fetch(chr: string, min: number, max: number, callback: any, opts: any) {
    const thisB = this;
    opts = opts || {};

    const chrId: number = this.chrToIndex[chr];
    let chunks: Chunk[];
    if (chrId === undefined) {
      chunks = [];
    } else {
      // Fetch this portion of the BAI if it hasn't been loaded yet.
      if (this.indices[chrId] === null && this.indexChunks.chunks[chrId]) {
        const start_stop = this.indexChunks.chunks[chrId];
        return this.bai.slice(start_stop[0], start_stop[1])
          .fetch(
          (data: any) => {
            const buffer = new Uint8Array(data);
            this.indices[chrId] = buffer;
            return this.fetch(chr, min, max, callback, opts);
          }
          );
      }

      chunks = this.blocksForRange(chrId, min, max);
      if (!chunks) {
        callback(null, 'Error in index fetch');
      }
    }

    const records: any[] = [];
    let index = 0;
    let data: ArrayBuffer;

    function tramp(): any {
      if (index >= chunks.length) {
        return callback(records);
      } else if (!data) {
        var c = chunks[index];
        var fetchMin = c.minv.block;
        var fetchMax = c.maxv.block + (1 << 16); // *sigh*
        // console.log('fetching ' + fetchMin + ':' + fetchMax);
        thisB.data.slice(fetchMin, fetchMax - fetchMin).fetch(function (r: ArrayBuffer) {
          data = BGZF.unzip(r, c.maxv.block - c.minv.block + 1);
          return tramp();
        });
      } else {
        var ba = new Uint8Array(data);
        var finished = thisB.readBamRecords(ba, chunks[index].minv.offset, records, min, max, chrId, opts);
        data = null;
        ++index;
        if (finished)
          return callback(records);
        else
          return tramp();
      }
    }
    tramp();
  }

  readBamRecords(ba: Uint8Array, offset: number, sink: BamRecord[], min: number, max: number, chrId: number, opts: any) {
    while (true) {
      const blockSize = NumberReader.readInt(ba, offset);
      const blockEnd = offset + blockSize + 4;
      if (blockEnd >= ba.length) {
        return false;
      }

      const record: BamRecord = new BamRecord();

      const refID = NumberReader.readInt(ba, offset + 4);
      const pos = NumberReader.readInt(ba, offset + 8);

      const bmn = NumberReader.readInt(ba, offset + 12);
      const bin = (bmn & 0xffff0000) >> 16;
      const mq = (bmn & 0xff00) >> 8;
      const nl = bmn & 0xff;

      const flag_nc = NumberReader.readInt(ba, offset + 16);
      const flag = (flag_nc & 0xffff0000) >> 16;
      const nc = flag_nc & 0xffff;

      const lseq = NumberReader.readInt(ba, offset + 20);

      const nextRef = NumberReader.readInt(ba, offset + 24);
      const nextPos = NumberReader.readInt(ba, offset + 28);

      const tlen = NumberReader.readInt(ba, offset + 32);

      record.segment = this.indexToChr[refID];
      record.flag = flag;
      record.pos = pos;
      record.mq = mq;
      if (opts.light)
        record.seqLength = lseq;

      if (!opts.light) {
        if (nextRef >= 0) {
          record.nextSegment = this.indexToChr[nextRef];
          record.nextPos = nextPos;
        }

        let readName = '';
        for (let j = 0; j < nl - 1; ++j) {
          readName += String.fromCharCode(ba[offset + 36 + j]);
        }
        record.readName = readName;

        let p = offset + 36 + nl;

        let cigar = '';
        for (let c = 0; c < nc; ++c) {
          const cigop = NumberReader.readInt(ba, p);
          cigar = cigar + (cigop >> 4) + BamFile.CIGAR_DECODER[cigop & 0xf];
          p += 4;
        }
        record.cigar = cigar;

        let seq = '';
        const seqBytes = (lseq + 1) >> 1;
        for (let j = 0; j < seqBytes; ++j) {
          const sb = ba[p + j];
          seq += BamFile.SEQRET_DECODER[(sb & 0xf0) >> 4];
          if (seq.length < lseq)
            seq += BamFile.SEQRET_DECODER[(sb & 0x0f)];
        }
        p += seqBytes;
        record.seq = seq;

        let qseq = '';
        for (var j = 0; j < lseq; ++j) {
          qseq += String.fromCharCode(ba[p + j] + 33);
        }
        p += lseq;
        record.quals = qseq;

        while (p < blockEnd) {
          const tag = String.fromCharCode(ba[p], ba[p + 1]);
          const type = String.fromCharCode(ba[p + 2]);
          let value;

          if (type == 'A') {
            value = String.fromCharCode(ba[p + 3]);
            p += 4;
          } else if (type == 'i' || type == 'I') {
            value = NumberReader.readInt(ba, p + 3);
            p += 7;
          } else if (type == 'c' || type == 'C') {
            value = ba[p + 3];
            p += 4;
          } else if (type == 's' || type == 'S') {
            value = NumberReader.readShort(ba, p + 3);
            p += 5;
          } else if (type == 'f') {
            value = NumberReader.readFloat(ba, p + 3);
            p += 7;
          } else if (type == 'Z' || type == 'H') {
            p += 3;
            value = '';
            for (; ;) {
              const cc = ba[p++];
              if (cc == 0) {
                break;
              } else {
                value += String.fromCharCode(cc);
              }
            }
          } else if (type == 'B') {
            const atype = String.fromCharCode(ba[p + 3]);
            const alen = NumberReader.readInt(ba, p + 4);
            let elen;
            let reader;
            if (atype == 'i' || atype == 'I' || atype == 'f') {
              elen = 4;
              if (atype == 'f')
                reader = NumberReader.readFloat;
              else
                reader = NumberReader.readInt;
            } else if (atype == 's' || atype == 'S') {
              elen = 2;
              reader = NumberReader.readShort;
            } else if (atype == 'c' || atype == 'C') {
              elen = 1;
              reader = NumberReader.readByte;
            } else {
              throw 'Unknown array type ' + atype;
            }

            p += 8;
            value = [];
            for (let i = 0; i < alen; ++i) {
              value.push(reader(ba, p));
              p += elen;
            }
          } else {
            throw 'Unknown type ' + type;
          }
          (<any>record)[tag] = value;
        }
      }

      if (!min || record.pos <= max && record.pos + lseq >= min) {
        if (chrId === undefined || refID == chrId) {
          sink.push(record);
        }
      }
      if (record.pos > max) {
        return true;
      }
      offset = blockEnd;
    }

    // Exits via top of loop.
  };



}