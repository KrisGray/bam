(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var BamRecord = /** @class */ (function () {
    function BamRecord() {
    }
    return BamRecord;
}());
exports.default = BamRecord;

},{}],2:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var vob_1 = require("./vob"); //methods: readVob
var bgzf_1 = require("./bgzf");
var bin_1 = require("./bin");
var chunk_1 = require("./chunk");
var bam_record_1 = require("./bam-record");
var Utils = /** @class */ (function () {
    function Utils() {
    }
    Utils.numberReader = function (type, ba, offset) {
        var dispatch = {
            int: bin_1.NumberReader.readInt,
            int64: bin_1.NumberReader.readInt64,
            short: bin_1.NumberReader.readShort,
            byte: bin_1.NumberReader.readByte,
            intBE: bin_1.NumberReader.readIntBE,
            float: bin_1.NumberReader.readFloat
        };
        if (dispatch[type]) {
            return dispatch[type](ba, offset);
        }
        else {
            throw new Error('Type not recognised');
        }
    };
    Utils.urlFetchableFactory = function (url, start, end, opts) {
        return new bin_1.URLFetchable(url, start, end, opts);
    };
    Utils.blobFetchableFactory = function (blob) {
        return new bin_1.BlobFetchable(blob);
    };
    return Utils;
}());
exports.Utils = Utils;
var BamFile = /** @class */ (function () {
    function BamFile() {
    }
    BamFile.factory = function (data, bai, callback, attempted, indexChunks) {
        var bam = new BamFile();
        bam.data = data;
        bam.bai = bai;
        bam.indexChunks = indexChunks || undefined;
        var minBlockIndex = bam.indexChunks ? bam.indexChunks.minBlockIndex : 1000000000;
        // Fills out bam.chrToIndex and bam.indexToChr based on the first few bytes of the BAM.
        var parseBamHeader = function (r) {
            if (!r) {
                return callback(null, "Couldn't access BAM");
            }
            var unc = bgzf_1.default.unzip(r, r.byteLength);
            var uncba = new Uint8Array(unc);
            var magic = bin_1.NumberReader.readInt(uncba, 0);
            if (magic != BamFile.BAM_MAGIC) {
                return callback(null, "Not a BAM file, magic=0x" + magic.toString(16));
            }
            var headLen = bin_1.NumberReader.readInt(uncba, 4);
            var header = '';
            for (var i_1 = 0; i_1 < headLen; ++i_1) {
                header += String.fromCharCode(uncba[i_1 + 8]);
            }
            var nRef = bin_1.NumberReader.readInt(uncba, headLen + 8);
            var p = headLen + 12;
            bam.chrToIndex = {};
            bam.indexToChr = [];
            for (var i_2 = 0; i_2 < nRef; ++i_2) {
                var lName = bin_1.NumberReader.readInt(uncba, p);
                var name_1 = '';
                for (var j = 0; j < lName - 1; ++j) {
                    name_1 += String.fromCharCode(uncba[p + 4 + j]);
                }
                var lRef = bin_1.NumberReader.readInt(uncba, p + lName + 4);
                bam.chrToIndex[name_1] = i_2;
                if (name_1.indexOf('chr') == 0) {
                    bam.chrToIndex[name_1.substring(3)] = i_2;
                }
                else {
                    bam.chrToIndex['chr' + name_1] = i_2;
                }
                bam.indexToChr.push(name_1);
                p = p + 8 + lName;
            }
            if (bam.indices) {
                return callback(bam);
            }
        };
        var parseBai = function (header) {
            if (!header) {
                return "Couldn't access BAI";
            }
            var uncba = new Uint8Array(header);
            var baiMagic = bin_1.NumberReader.readInt(uncba, 0);
            if (baiMagic != BamFile.BAI_MAGIC) {
                return callback(null, 'Not a BAI file, magic=0x' + baiMagic.toString(16));
            }
            var nref = bin_1.NumberReader.readInt(uncba, 4);
            bam.indices = [];
            var p = 8;
            for (var ref = 0; ref < nref; ++ref) {
                var blockStart = p;
                var o = BamFile.getBaiRefLength(uncba, blockStart);
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
            bam.bai.fetch(function (header) {
                var result = parseBai(header);
                if (result !== true) {
                    if (bam.bai.url && typeof (attempted) === "undefined") {
                        // Already attempted x.bam.bai not there so now trying x.bai
                        bam.bai.url = bam.data.url.replace(new RegExp('.bam$'), '.bai');
                        // True lets us know we are making a second attempt
                        return BamFile.factory(data, bam.bai, callback, true, indexChunks);
                    }
                    else {
                        // We've attempted x.bam.bai & x.bai and nothing worked
                        callback(null, result);
                    }
                }
                else {
                    bam.data.slice(0, minBlockIndex).fetch(parseBamHeader, { timeout: 5000 });
                }
            }, { timeout: 5000 }); // Timeout on first request to catch Chrome mixed-content error.
        }
        else {
            var chunks = bam.indexChunks.chunks;
            bam.indices = [];
            for (var i = 0; i < chunks.length; i++) {
                bam.indices[i] = null; // To be filled out lazily as needed
            }
            bam.data.slice(0, minBlockIndex).fetch(parseBamHeader);
        }
        return bam;
    };
    BamFile.getBaiRefLength = function (uncba, offset) {
        var p = offset;
        var nbin = bin_1.NumberReader.readInt(uncba, p);
        p += 4;
        for (var b = 0; b < nbin; ++b) {
            var bin = bin_1.NumberReader.readInt(uncba, p); // not used?
            var nchnk = bin_1.NumberReader.readInt(uncba, p + 4);
            p += 8 + (nchnk * 16);
        }
        var nintv = bin_1.NumberReader.readInt(uncba, p);
        p += 4;
        var minBlockIndex = 1000000000;
        var q = p;
        for (var i = 0; i < nintv; ++i) {
            var v = vob_1.default.factory(uncba, q);
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
    };
    //
    // Binning (transliterated from SAM1.3 spec)
    //
    /* calculate bin given an alignment covering [beg,end) (zero-based, half-close-half-open) */
    BamFile.reg2bin = function (beg, end) {
        --end;
        if (beg >> 14 == end >> 14)
            return ((1 << 15) - 1) / 7 + (beg >> 14);
        if (beg >> 17 == end >> 17)
            return ((1 << 12) - 1) / 7 + (beg >> 17);
        if (beg >> 20 == end >> 20)
            return ((1 << 9) - 1) / 7 + (beg >> 20);
        if (beg >> 23 == end >> 23)
            return ((1 << 6) - 1) / 7 + (beg >> 23);
        if (beg >> 26 == end >> 26)
            return ((1 << 3) - 1) / 7 + (beg >> 26);
        return 0;
    };
    /* calculate the list of bins that may overlap with region [beg,end) (zero-based) */
    BamFile.reg2bins = function (beg, end) {
        var k;
        var list = [];
        --end;
        list.push(0);
        for (k = 1 + (beg >> 26); k <= 1 + (end >> 26); ++k)
            list.push(k);
        for (k = 9 + (beg >> 23); k <= 9 + (end >> 23); ++k)
            list.push(k);
        for (k = 73 + (beg >> 20); k <= 73 + (end >> 20); ++k)
            list.push(k);
        for (k = 585 + (beg >> 17); k <= 585 + (end >> 17); ++k)
            list.push(k);
        for (k = 4681 + (beg >> 14); k <= 4681 + (end >> 14); ++k)
            list.push(k);
        return list;
    };
    BamFile.prototype.blocksForRange = function (refId, min, max) {
        var index = this.indices[refId];
        if (!index) {
            return [];
        }
        var intBinsL = BamFile.reg2bins(min, max);
        var intBins = [];
        for (var i = 0; i < intBinsL.length; ++i) {
            intBins[intBinsL[i]] = true;
        }
        var leafChunks = [];
        var otherChunks = [];
        var nbin = bin_1.NumberReader.readInt(index, 0);
        var p = 4;
        for (var b = 0; b < nbin; ++b) {
            var bin = bin_1.NumberReader.readInt(index, p);
            var nchnk = bin_1.NumberReader.readInt(index, p + 4);
            // dlog('bin=' + bin + '; nchnk=' + nchnk);
            p += 8;
            if (intBins[bin]) {
                for (var c = 0; c < nchnk; ++c) {
                    var cs = vob_1.default.factory(index, p);
                    var ce = vob_1.default.factory(index, p + 8);
                    (bin < 4681 ? otherChunks : leafChunks).push(new chunk_1.default(cs, ce));
                    p += 16;
                }
            }
            else {
                p += (nchnk * 16);
            }
        }
        var nintv = bin_1.NumberReader.readInt(index, p);
        var lowest = null;
        var minLin = Math.min(min >> 14, nintv - 1), maxLin = Math.min(max >> 14, nintv - 1);
        for (var i_3 = minLin; i_3 <= maxLin; ++i_3) {
            var lb = vob_1.default.factory(index, p + 4 + (i_3 * 8));
            if (!lb) {
                continue;
            }
            if (!lowest || lb.block < lowest.block || lb.offset < lowest.offset) {
                lowest = lb;
            }
        }
        var prunedOtherChunks = [];
        if (lowest != null) {
            for (var i_4 = 0; i_4 < otherChunks.length; ++i_4) {
                var chnk = otherChunks[i_4];
                if (chnk.maxv.block >= lowest.block && chnk.maxv.offset >= lowest.offset) {
                    prunedOtherChunks.push(chnk);
                }
            }
        }
        otherChunks = prunedOtherChunks;
        var intChunks = [];
        for (var i_5 = 0; i_5 < otherChunks.length; ++i_5) {
            intChunks.push(otherChunks[i_5]);
        }
        for (var i_6 = 0; i_6 < leafChunks.length; ++i_6) {
            intChunks.push(leafChunks[i_6]);
        }
        intChunks.sort(function (c0, c1) {
            var dif = c0.minv.block - c1.minv.block;
            if (dif != 0) {
                return dif;
            }
            else {
                return c0.minv.offset - c1.minv.offset;
            }
        });
        var mergedChunks = [];
        if (intChunks.length > 0) {
            var cur = intChunks[0];
            for (var i_7 = 1; i_7 < intChunks.length; ++i_7) {
                var nc = intChunks[i_7];
                if (nc.minv.block == cur.maxv.block /* && nc.minv.offset == cur.maxv.offset */) {
                    cur = new chunk_1.default(cur.minv, nc.maxv);
                }
                else {
                    mergedChunks.push(cur);
                    cur = nc;
                }
            }
            mergedChunks.push(cur);
        }
        return mergedChunks;
    };
    BamFile.prototype.fetch = function (chr, min, max, callback, opts) {
        var _this = this;
        var thisB = this;
        opts = opts || {};
        var chrId = this.chrToIndex[chr];
        var chunks;
        if (chrId === undefined) {
            chunks = [];
        }
        else {
            // Fetch this portion of the BAI if it hasn't been loaded yet.
            if (this.indices[chrId] === null && this.indexChunks.chunks[chrId]) {
                var start_stop = this.indexChunks.chunks[chrId];
                return this.bai.slice(start_stop[0], start_stop[1])
                    .fetch(function (data) {
                    var buffer = new Uint8Array(data);
                    _this.indices[chrId] = buffer;
                    return _this.fetch(chr, min, max, callback, opts);
                });
            }
            chunks = this.blocksForRange(chrId, min, max);
            if (!chunks) {
                callback(null, 'Error in index fetch');
            }
        }
        var records = [];
        var index = 0;
        var data;
        function tramp() {
            if (index >= chunks.length) {
                return callback(records);
            }
            else if (!data) {
                var c = chunks[index];
                var fetchMin = c.minv.block;
                var fetchMax = c.maxv.block + (1 << 16); // *sigh*
                // console.log('fetching ' + fetchMin + ':' + fetchMax);
                thisB.data.slice(fetchMin, fetchMax - fetchMin).fetch(function (r) {
                    data = bgzf_1.default.unzip(r, c.maxv.block - c.minv.block + 1);
                    return tramp();
                });
            }
            else {
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
    };
    BamFile.prototype.readBamRecords = function (ba, offset, sink, min, max, chrId, opts) {
        while (true) {
            var blockSize = bin_1.NumberReader.readInt(ba, offset);
            var blockEnd = offset + blockSize + 4;
            if (blockEnd >= ba.length) {
                return false;
            }
            var record = new bam_record_1.default();
            var refID = bin_1.NumberReader.readInt(ba, offset + 4);
            var pos = bin_1.NumberReader.readInt(ba, offset + 8);
            var bmn = bin_1.NumberReader.readInt(ba, offset + 12);
            var bin = (bmn & 0xffff0000) >> 16;
            var mq = (bmn & 0xff00) >> 8;
            var nl = bmn & 0xff;
            var flag_nc = bin_1.NumberReader.readInt(ba, offset + 16);
            var flag = (flag_nc & 0xffff0000) >> 16;
            var nc = flag_nc & 0xffff;
            var lseq = bin_1.NumberReader.readInt(ba, offset + 20);
            var nextRef = bin_1.NumberReader.readInt(ba, offset + 24);
            var nextPos = bin_1.NumberReader.readInt(ba, offset + 28);
            var tlen = bin_1.NumberReader.readInt(ba, offset + 32);
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
                var readName = '';
                for (var j_1 = 0; j_1 < nl - 1; ++j_1) {
                    readName += String.fromCharCode(ba[offset + 36 + j_1]);
                }
                record.readName = readName;
                var p = offset + 36 + nl;
                var cigar = '';
                for (var c = 0; c < nc; ++c) {
                    var cigop = bin_1.NumberReader.readInt(ba, p);
                    cigar = cigar + (cigop >> 4) + BamFile.CIGAR_DECODER[cigop & 0xf];
                    p += 4;
                }
                record.cigar = cigar;
                var seq = '';
                var seqBytes = (lseq + 1) >> 1;
                for (var j_2 = 0; j_2 < seqBytes; ++j_2) {
                    var sb = ba[p + j_2];
                    seq += BamFile.SEQRET_DECODER[(sb & 0xf0) >> 4];
                    if (seq.length < lseq)
                        seq += BamFile.SEQRET_DECODER[(sb & 0x0f)];
                }
                p += seqBytes;
                record.seq = seq;
                var qseq = '';
                for (var j = 0; j < lseq; ++j) {
                    qseq += String.fromCharCode(ba[p + j] + 33);
                }
                p += lseq;
                record.quals = qseq;
                while (p < blockEnd) {
                    var tag = String.fromCharCode(ba[p], ba[p + 1]);
                    var type = String.fromCharCode(ba[p + 2]);
                    var value = void 0;
                    if (type == 'A') {
                        value = String.fromCharCode(ba[p + 3]);
                        p += 4;
                    }
                    else if (type == 'i' || type == 'I') {
                        value = bin_1.NumberReader.readInt(ba, p + 3);
                        p += 7;
                    }
                    else if (type == 'c' || type == 'C') {
                        value = ba[p + 3];
                        p += 4;
                    }
                    else if (type == 's' || type == 'S') {
                        value = bin_1.NumberReader.readShort(ba, p + 3);
                        p += 5;
                    }
                    else if (type == 'f') {
                        value = bin_1.NumberReader.readFloat(ba, p + 3);
                        p += 7;
                    }
                    else if (type == 'Z' || type == 'H') {
                        p += 3;
                        value = '';
                        for (;;) {
                            var cc = ba[p++];
                            if (cc == 0) {
                                break;
                            }
                            else {
                                value += String.fromCharCode(cc);
                            }
                        }
                    }
                    else if (type == 'B') {
                        var atype = String.fromCharCode(ba[p + 3]);
                        var alen = bin_1.NumberReader.readInt(ba, p + 4);
                        var elen = void 0;
                        var reader = void 0;
                        if (atype == 'i' || atype == 'I' || atype == 'f') {
                            elen = 4;
                            if (atype == 'f')
                                reader = bin_1.NumberReader.readFloat;
                            else
                                reader = bin_1.NumberReader.readInt;
                        }
                        else if (atype == 's' || atype == 'S') {
                            elen = 2;
                            reader = bin_1.NumberReader.readShort;
                        }
                        else if (atype == 'c' || atype == 'C') {
                            elen = 1;
                            reader = bin_1.NumberReader.readByte;
                        }
                        else {
                            throw 'Unknown array type ' + atype;
                        }
                        p += 8;
                        value = [];
                        for (var i = 0; i < alen; ++i) {
                            value.push(reader(ba, p));
                            p += elen;
                        }
                    }
                    else {
                        throw 'Unknown type ' + type;
                    }
                    record[tag] = value;
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
    ;
    BamFile.BAM_MAGIC = 0x14d4142;
    BamFile.BAI_MAGIC = 0x1494142;
    BamFile.BamFlags = {
        MULTIPLE_SEGMENTS: 0x1,
        ALL_SEGMENTS_ALIGN: 0x2,
        SEGMENT_UNMAPPED: 0x4,
        NEXT_SEGMENT_UNMAPPED: 0x8,
        REVERSE_COMPLEMENT: 0x10,
        NEXT_REVERSE_COMPLEMENT: 0x20,
        FIRST_SEGMENT: 0x40,
        LAST_SEGMENT: 0x80,
        SECONDARY_ALIGNMENT: 0x100,
        QC_FAIL: 0x200,
        DUPLICATE: 0x400,
        SUPPLEMENTARY: 0x800
    };
    BamFile.SEQRET_DECODER = ['=', 'A', 'C', 'x', 'G', 'x', 'x', 'x', 'T', 'x', 'x', 'x', 'x', 'x', 'x', 'N'];
    BamFile.CIGAR_DECODER = ['M', 'I', 'D', 'N', 'S', 'H', 'P', '=', 'X', '?', '?', '?', '?', '?', '?', '?'];
    return BamFile;
}());
exports.BamFile = BamFile;

},{"./bam-record":1,"./bgzf":3,"./bin":4,"./chunk":5,"./vob":8}],3:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var jszlib = require("jszlib");
var BGZF = /** @class */ (function () {
    function BGZF() {
    }
    BGZF.unzip = function (data, lim) {
        lim = Math.min(lim || 1, data.byteLength - 50);
        var oBlockList = [];
        var ptr = [0];
        var totalSize = 0;
        while (ptr[0] < lim) {
            var ba = new Uint8Array(data, ptr[0], 12); // FIXME is this enough for all credible BGZF block headers?
            var xlen = (ba[11] << 8) | (ba[10]);
            // dlog('xlen[' + (ptr[0]) +']=' + xlen);
            var unc = jszlib.inflateBuffer(data, 12 + xlen + ptr[0], Math.min(65536, data.byteLength - 12 - xlen - ptr[0]), ptr);
            ptr[0] += 8;
            totalSize += unc.byteLength;
            oBlockList.push(unc);
        }
        if (oBlockList.length == 1) {
            return oBlockList[0];
        }
        else {
            var out = new Uint8Array(totalSize);
            var cursor = 0;
            for (var i = 0; i < oBlockList.length; ++i) {
                var b = new Uint8Array(oBlockList[i]);
                jszlib.arrayCopy(b, 0, out, cursor, b.length);
                cursor += b.length;
            }
            return out.buffer;
        }
    };
    return BGZF;
}());
exports.default = BGZF;

},{"jszlib":9}],4:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var utils_1 = require("./utils");
var sha1_1 = require("./sha1");
var FileReaderSync = /** @class */ (function () {
    /**
     * @see http://www.w3.org/TR/FileAPI/#FileReaderSyncSync
     * @constructor
     */
    function FileReaderSync() {
    }
    /**
    * @see http://www.w3.org/TR/FileAPI/#dfn-readAsArrayBufferSync
    * @param {!Blob} blob
    */
    FileReaderSync.prototype.readAsArrayBuffer = function (blob) { };
    ;
    /**
     * @see http://www.w3.org/TR/FileAPI/#dfn-readAsBinaryStringSync
     * @param {!Blob} blob
     */
    FileReaderSync.prototype.readAsBinaryString = function (blob) { };
    ;
    /**
     * @see http://www.w3.org/TR/FileAPI/#dfn-readAsTextSync
     * @param {!Blob} blob
     * @param {string=} encoding
     */
    FileReaderSync.prototype.readAsText = function (blob, encoding) { };
    ;
    /**
     * @see http://www.w3.org/TR/FileAPI/#dfn-readAsDataURLSync
     * @param {!Blob} blob
     */
    FileReaderSync.prototype.readAsDataURL = function (blob) { };
    ;
    return FileReaderSync;
}());
var Fetchable = /** @class */ (function () {
    function Fetchable() {
    }
    Fetchable.bstringToBuffer = function (result) {
        if (!result) {
            return null;
        }
        var ba = new Uint8Array(result.length);
        for (var i = 0; i < ba.length; ++i) {
            ba[i] = result.charCodeAt(i);
        }
        return ba.buffer;
    };
    return Fetchable;
}());
var BlobFetchable = /** @class */ (function (_super) {
    __extends(BlobFetchable, _super);
    function BlobFetchable(blob) {
        var _this = _super.call(this) || this;
        _this.blob = blob;
        return _this;
    }
    BlobFetchable.prototype.slice = function (start, length) {
        var b;
        if (this.blob.slice) {
            if (length) {
                b = this.blob.slice(start, start + length);
            }
            else {
                b = this.blob.slice(start);
            }
        }
        else {
            if (length) {
                b = this.blob.webkitSlice(start, start + length);
            }
            else {
                b = this.blob.webkitSlice(start);
            }
        }
        return new BlobFetchable(b);
    };
    BlobFetchable.prototype.salted = function () {
        return this;
    };
    BlobFetchable.prototype.fetch = function (callback) {
        if (typeof (FileReader) !== 'undefined') {
            // console.log('defining async BlobFetchable.fetch');
            var reader_1 = new FileReader();
            reader_1.onloadend = function (ev) {
                callback(BlobFetchable.bstringToBuffer(reader_1.result));
            };
            reader_1.readAsBinaryString(this.blob);
        }
        else {
            // if (console && console.log)
            //    console.log('defining sync BlobFetchable.fetch');
            var reader = new FileReaderSync();
            try {
                var res = reader.readAsArrayBuffer(this.blob);
                callback(res);
            }
            catch (e) {
                callback(null, e);
            }
        }
    };
    return BlobFetchable;
}(Fetchable));
exports.BlobFetchable = BlobFetchable;
var URLFetchable = /** @class */ (function (_super) {
    __extends(URLFetchable, _super);
    function URLFetchable(url, start, end, opts) {
        var _this = _super.call(this) || this;
        if (!opts) {
            if (typeof start === 'object') {
                opts = start;
                start = undefined;
            }
            else {
                opts = {};
            }
        }
        _this.url = url;
        _this.start = start || 0;
        if (end) {
            _this.end = end;
        }
        _this.opts = opts;
        return _this;
    }
    URLFetchable.prototype.slice = function (s, l) {
        if (s < 0) {
            throw 'Bad slice ' + s;
        }
        var ns = this.start, ne = this.end;
        if (ns && s) {
            ns = ns + s;
        }
        else {
            ns = s || ns;
        }
        if (l && ns) {
            ne = ns + l - 1;
        }
        else {
            ne = ne || l - 1;
        }
        return new URLFetchable(this.url, ns, ne, this.opts);
    };
    URLFetchable.prototype.fetchAsText = function (callback) {
        try {
            var req_1 = new XMLHttpRequest();
            var length_1;
            var url = this.url;
            if ((URLFetchable.isSafari || this.opts.salt) && url.indexOf('?') < 0) {
                var sha1 = new sha1_1.default('' + Date.now() + ',' + (++URLFetchable.seed));
                url = url + '?salt=' + sha1.b64_sha1;
            }
            req_1.open('GET', url, true);
            if (this.end) {
                if (this.end - this.start > 100000000) {
                    throw 'Monster fetch!';
                }
                req_1.setRequestHeader('Range', 'bytes=' + this.start + '-' + this.end);
                length_1 = this.end - this.start + 1;
            }
            req_1.onreadystatechange = function () {
                if (req_1.readyState == 4) {
                    if (req_1.status == 200 || req_1.status == 206) {
                        return callback(req_1.responseText);
                    }
                    else {
                        return callback(null);
                    }
                }
            };
            if (this.opts.credentials) {
                req_1.withCredentials = true;
            }
            req_1.send('');
        }
        catch (e) {
            return callback(null);
        }
    };
    URLFetchable.prototype.salted = function () {
        var o = utils_1.default.shallowCopy(this.opts);
        o.salt = true;
        return new URLFetchable(this.url, this.start, this.end, o);
    };
    URLFetchable.prototype.fetch = function (callback, opts) {
        var thisB = this;
        opts = opts || {};
        var attempt = opts.attempt || 1;
        var truncatedLength = opts.truncatedLength;
        if (attempt > 3) {
            return callback(null);
        }
        try {
            var timeout_1;
            if (opts.timeout && !this.opts.credentials) {
                timeout_1 = setTimeout(function () {
                    console.log('timing out ' + url_1);
                    req_2.abort();
                    return callback(null, 'Timeout');
                }, opts.timeout);
            }
            var req_2 = new XMLHttpRequest();
            var length_2;
            var url_1 = this.url;
            if ((URLFetchable.isSafari || this.opts.salt) && url_1.indexOf('?') < 0) {
                var sha1 = new sha1_1.default('' + Date.now() + ',' + (++URLFetchable.seed));
                url_1 = url_1 + '?salt=' + sha1.b64_sha1;
            }
            req_2.open('GET', url_1, true);
            req_2.overrideMimeType('text/plain; charset=x-user-defined');
            if (this.end) {
                if (this.end - this.start > 100000000) {
                    throw 'Monster fetch!';
                }
                req_2.setRequestHeader('Range', 'bytes=' + this.start + '-' + this.end);
                length_2 = this.end - this.start + 1;
            }
            req_2.responseType = 'arraybuffer';
            req_2.onreadystatechange = function () {
                if (req_2.readyState == 4) {
                    if (timeout_1)
                        clearTimeout(timeout_1);
                    if (req_2.status == 200 || req_2.status == 206) {
                        if (req_2.response) {
                            var bl = req_2.response.byteLength;
                            if (length_2 && length_2 != bl && (!truncatedLength || bl != truncatedLength)) {
                                return thisB.fetch(callback, { attempt: attempt + 1, truncatedLength: bl });
                            }
                            else {
                                return callback(req_2.response);
                            }
                        }
                        else if (req_2.mozResponseArrayBuffer) {
                            return callback(req_2.mozResponseArrayBuffer);
                        }
                        else {
                            var r = req_2.responseText;
                            if (length_2 && length_2 != r.length && (!truncatedLength || r.length != truncatedLength)) {
                                return thisB.fetch(callback, { attempt: attempt + 1, truncatedLength: r.length });
                            }
                            else {
                                return callback(URLFetchable.bstringToBuffer(req_2.responseText));
                            }
                        }
                    }
                    else {
                        return thisB.fetch(callback, { attempt: attempt + 1 });
                    }
                }
            };
            if (this.opts.credentials) {
                req_2.withCredentials = true;
            }
            req_2.send('');
        }
        catch (e) {
            return callback(null);
        }
    };
    URLFetchable.seed = 0;
    URLFetchable.isSafari = navigator.userAgent.indexOf('Safari') >= 0 && navigator.userAgent.indexOf('Chrome') < 0;
    return URLFetchable;
}(Fetchable));
exports.URLFetchable = URLFetchable;
var NumberReader = /** @class */ (function () {
    function NumberReader() {
    }
    NumberReader.readInt = function (ba, offset) {
        return (ba[offset + 3] << 24) | (ba[offset + 2] << 16) | (ba[offset + 1] << 8) | (ba[offset]);
    };
    NumberReader.readInt64 = function (ba, offset) {
        return (ba[offset + 7] << 24) | (ba[offset + 6] << 16) | (ba[offset + 5] << 8) | (ba[offset + 4]);
    };
    NumberReader.readShort = function (ba, offset) {
        return (ba[offset + 1] << 8) | (ba[offset]);
    };
    NumberReader.readByte = function (ba, offset) {
        return ba[offset];
    };
    NumberReader.readIntBE = function (ba, offset) {
        return (ba[offset] << 24) | (ba[offset + 1] << 16) | (ba[offset + 2] << 8) | (ba[offset + 3]);
    };
    NumberReader.readFloat = function (buf, offset) {
        var convertBuffer = new ArrayBuffer(8);
        var dataview = new DataView(convertBuffer);
        for (var i = 0; i < 4; i++) {
            dataview.setUint8(i, buf[offset + i]);
        }
        return dataview.getFloat32(0);
    };
    return NumberReader;
}());
exports.NumberReader = NumberReader;

},{"./sha1":6,"./utils":7}],5:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Chunk = /** @class */ (function () {
    function Chunk(minv, maxv) {
        this.maxv = maxv;
        this.minv = minv;
    }
    return Chunk;
}());
exports.default = Chunk;

},{}],6:[function(require,module,exports){
"use strict";
/*
 * A JavaScript implementation of the Secure Hash Algorithm, SHA-1, as defined
 * in FIPS 180-1
 * Version 3.0 Copyright Kristian Gray 2017.
 * Other contributors: Paul Johnston, Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for details.
 */
Object.defineProperty(exports, "__esModule", { value: true });
var SHA1 = /** @class */ (function () {
    function SHA1(input) {
        this._query = input;
        this._b64_sha1 = SHA1.rstr2b64(SHA1.rstr_sha1(SHA1.str2rstr_utf8(this._query)));
    }
    Object.defineProperty(SHA1.prototype, "b64_sha1", {
        get: function () {
            return this._b64_sha1;
        },
        enumerable: true,
        configurable: true
    });
    /*
    * Convert a raw string to a base-64 string
    */
    SHA1.rstr2b64 = function (input) {
        // try { b64pad } catch(e) { b64pad=''; }
        var tab = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var output = "";
        var len = input.length;
        for (var i = 0; i < len; i += 3) {
            var triplet = (input.charCodeAt(i) << 16)
                | (i + 1 < len ? input.charCodeAt(i + 1) << 8 : 0)
                | (i + 2 < len ? input.charCodeAt(i + 2) : 0);
            for (var j = 0; j < 4; j++) {
                if (i * 8 + j * 6 > input.length * 8)
                    output += SHA1.b64pad;
                else
                    output += tab.charAt((triplet >>> 6 * (3 - j)) & 0x3F);
            }
        }
        return output;
    };
    /*
    * Encode a string as utf-8.
    * For efficiency, this assumes the input is valid utf-16.
    */
    SHA1.str2rstr_utf8 = function (input) {
        var output = '';
        var i = -1;
        var x, y;
        while (++i < input.length) {
            /* Decode utf-16 surrogate pairs */
            x = input.charCodeAt(i);
            y = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
            if (0xD800 <= x && x <= 0xDBFF && 0xDC00 <= y && y <= 0xDFFF) {
                x = 0x10000 + ((x & 0x03FF) << 10) + (y & 0x03FF);
                i++;
            }
            /* Encode output as utf-8 */
            if (x <= 0x7F)
                output += String.fromCharCode(x);
            else if (x <= 0x7FF)
                output += String.fromCharCode(0xC0 | ((x >>> 6) & 0x1F), 0x80 | (x & 0x3F));
            else if (x <= 0xFFFF)
                output += String.fromCharCode(0xE0 | ((x >>> 12) & 0x0F), 0x80 | ((x >>> 6) & 0x3F), 0x80 | (x & 0x3F));
            else if (x <= 0x1FFFFF)
                output += String.fromCharCode(0xF0 | ((x >>> 18) & 0x07), 0x80 | ((x >>> 12) & 0x3F), 0x80 | ((x >>> 6) & 0x3F), 0x80 | (x & 0x3F));
        }
        return output;
    };
    /*
    * Calculate the SHA1 of a raw string
    */
    SHA1.rstr_sha1 = function (rstr) {
        return SHA1.binb2rstr(SHA1.binb_sha1(SHA1.rstr2binb(rstr), rstr.length * 8));
    };
    /*
    * Convert a raw string to an array of big-endian words
    * Characters >255 have their high-byte silently ignored.
    */
    SHA1.rstr2binb = function (rstr) {
        var binb = new Array(rstr.length >> 2);
        for (var i = 0; i < binb.length; i++) {
            binb[i] = 0;
        }
        for (var i = 0; i < rstr.length * 8; i += 8) {
            binb[i >> 5] |= (rstr.charCodeAt(i / 8) & 0xFF) << (24 - i % 32);
        }
        return binb;
    };
    /*
    * Calculate the SHA-1 of an array of big-endian words, and a bit length
    */
    SHA1.binb_sha1 = function (binb, len) {
        /* append padding */
        binb[len >> 5] |= 0x80 << (24 - len % 32);
        binb[((len + 64 >> 9) << 4) + 15] = len;
        var w = new Array(80);
        var a = 1732584193;
        var b = -271733879;
        var c = -1732584194;
        var d = 271733878;
        var e = -1009589776;
        for (var i = 0; i < binb.length; i += 16) {
            var olda = a;
            var oldb = b;
            var oldc = c;
            var oldd = d;
            var olde = e;
            for (var j = 0; j < 80; j++) {
                if (j < 16) {
                    w[j] = binb[i + j];
                }
                else {
                    w[j] = SHA1.bit_rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
                }
                var t = SHA1.safe_add(SHA1.safe_add(SHA1.bit_rol(a, 5), SHA1.sha1_ft(j, b, c, d)), SHA1.safe_add(SHA1.safe_add(e, w[j]), SHA1.sha1_kt(j)));
                e = d;
                d = c;
                c = SHA1.bit_rol(b, 30);
                b = a;
                a = t;
            }
            a = SHA1.safe_add(a, olda);
            b = SHA1.safe_add(b, oldb);
            c = SHA1.safe_add(c, oldc);
            d = SHA1.safe_add(d, oldd);
            e = SHA1.safe_add(e, olde);
        }
        return new Array(a, b, c, d, e);
    };
    /*
    * Determine the appropriate additive constant for the current iteration
    */
    SHA1.sha1_kt = function (t) {
        return (t < 20) ? 1518500249 : (t < 40) ? 1859775393 :
            (t < 60) ? -1894007588 : -899497514;
    };
    /*
    * Perform the appropriate triplet combination function for the current
    * iteration
    */
    SHA1.sha1_ft = function (t, b, c, d) {
        if (t < 20)
            return (b & c) | ((~b) & d);
        if (t < 40)
            return b ^ c ^ d;
        if (t < 60)
            return (b & c) | (b & d) | (c & d);
        return b ^ c ^ d;
    };
    /*
    * Add integers, wrapping at 2^32. This uses 16-bit operations internally
    * to work around bugs in some JS interpreters.
    */
    SHA1.safe_add = function (x, y) {
        var lsw = (x & 0xFFFF) + (y & 0xFFFF);
        var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
        return (msw << 16) | (lsw & 0xFFFF);
    };
    /*
    * Bitwise rotate a 32-bit number to the left.
    */
    SHA1.bit_rol = function (num, cnt) {
        return (num << cnt) | (num >>> (32 - cnt));
    };
    /*
    * Convert an array of big-endian words to a string
    */
    SHA1.binb2rstr = function (input) {
        var output = "";
        for (var i = 0; i < input.length * 32; i += 8)
            output += String.fromCharCode((input[i >> 5] >>> (24 - i % 32)) & 0xFF);
        return output;
    };
    /*
    * Configurable variables. You may need to tweak these to be compatible with
    * the server-side, but the defaults work in most cases.
    */
    SHA1.b64pad = ''; /* base-64 pad character. "=" for strict RFC compliance   */
    return SHA1;
}());
exports.default = SHA1;

},{}],7:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Utils = /** @class */ (function () {
    function Utils() {
    }
    Utils.shallowCopy = function (o) {
        var n = {};
        for (var k in o) {
            n[k] = o[k];
        }
        return n;
    };
    return Utils;
}());
exports.default = Utils;

},{}],8:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Vob = /** @class */ (function () {
    function Vob(b, o) {
        this.block = b;
        this.offset = o;
    }
    Vob.prototype.toString = function () {
        return '' + this.block + ':' + this.offset;
    };
    Vob.factory = function (ba, offset) {
        var block = ((ba[offset + 6] & 0xff) * 0x100000000) + ((ba[offset + 5] & 0xff) * 0x1000000) + ((ba[offset + 4] & 0xff) * 0x10000) + ((ba[offset + 3] & 0xff) * 0x100) + ((ba[offset + 2] & 0xff));
        var bint = (ba[offset + 1] << 8) | (ba[offset]);
        if (block == 0 && bint == 0) {
            return null; // Should only happen in the linear index?
        }
        else {
            return new Vob(block, bint);
        }
    };
    return Vob;
}());
exports.default = Vob;

},{}],9:[function(require,module,exports){
/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Javascript ZLib
// By Thomas Down 2010-2011
//
// Based very heavily on portions of jzlib (by ymnk@jcraft.com), who in
// turn credits Jean-loup Gailly and Mark Adler for the original zlib code.
//
// inflate.js: ZLib inflate code
//

//
// Shared constants
//

var MAX_WBITS=15; // 32K LZ77 window
var DEF_WBITS=MAX_WBITS;
var MAX_MEM_LEVEL=9;
var MANY=1440;
var BMAX = 15;

// preset dictionary flag in zlib header
var PRESET_DICT=0x20;

var Z_NO_FLUSH=0;
var Z_PARTIAL_FLUSH=1;
var Z_SYNC_FLUSH=2;
var Z_FULL_FLUSH=3;
var Z_FINISH=4;

var Z_DEFLATED=8;

var Z_OK=0;
var Z_STREAM_END=1;
var Z_NEED_DICT=2;
var Z_ERRNO=-1;
var Z_STREAM_ERROR=-2;
var Z_DATA_ERROR=-3;
var Z_MEM_ERROR=-4;
var Z_BUF_ERROR=-5;
var Z_VERSION_ERROR=-6;

var METHOD=0;   // waiting for method byte
var FLAG=1;     // waiting for flag byte
var DICT4=2;    // four dictionary check bytes to go
var DICT3=3;    // three dictionary check bytes to go
var DICT2=4;    // two dictionary check bytes to go
var DICT1=5;    // one dictionary check byte to go
var DICT0=6;    // waiting for inflateSetDictionary
var BLOCKS=7;   // decompressing blocks
var CHECK4=8;   // four check bytes to go
var CHECK3=9;   // three check bytes to go
var CHECK2=10;  // two check bytes to go
var CHECK1=11;  // one check byte to go
var DONE=12;    // finished check, done
var BAD=13;     // got an error--stay here

var inflate_mask = [0x00000000, 0x00000001, 0x00000003, 0x00000007, 0x0000000f, 0x0000001f, 0x0000003f, 0x0000007f, 0x000000ff, 0x000001ff, 0x000003ff, 0x000007ff, 0x00000fff, 0x00001fff, 0x00003fff, 0x00007fff, 0x0000ffff];

var IB_TYPE=0;  // get type bits (3, including end bit)
var IB_LENS=1;  // get lengths for stored
var IB_STORED=2;// processing stored block
var IB_TABLE=3; // get table lengths
var IB_BTREE=4; // get bit lengths tree for a dynamic block
var IB_DTREE=5; // get length, distance trees for a dynamic block
var IB_CODES=6; // processing fixed or dynamic block
var IB_DRY=7;   // output remaining window bytes
var IB_DONE=8;  // finished last block, done
var IB_BAD=9;   // ot a data error--stuck here

var fixed_bl = 9;
var fixed_bd = 5;

var fixed_tl = [
    96,7,256, 0,8,80, 0,8,16, 84,8,115,
    82,7,31, 0,8,112, 0,8,48, 0,9,192,
    80,7,10, 0,8,96, 0,8,32, 0,9,160,
    0,8,0, 0,8,128, 0,8,64, 0,9,224,
    80,7,6, 0,8,88, 0,8,24, 0,9,144,
    83,7,59, 0,8,120, 0,8,56, 0,9,208,
    81,7,17, 0,8,104, 0,8,40, 0,9,176,
    0,8,8, 0,8,136, 0,8,72, 0,9,240,
    80,7,4, 0,8,84, 0,8,20, 85,8,227,
    83,7,43, 0,8,116, 0,8,52, 0,9,200,
    81,7,13, 0,8,100, 0,8,36, 0,9,168,
    0,8,4, 0,8,132, 0,8,68, 0,9,232,
    80,7,8, 0,8,92, 0,8,28, 0,9,152,
    84,7,83, 0,8,124, 0,8,60, 0,9,216,
    82,7,23, 0,8,108, 0,8,44, 0,9,184,
    0,8,12, 0,8,140, 0,8,76, 0,9,248,
    80,7,3, 0,8,82, 0,8,18, 85,8,163,
    83,7,35, 0,8,114, 0,8,50, 0,9,196,
    81,7,11, 0,8,98, 0,8,34, 0,9,164,
    0,8,2, 0,8,130, 0,8,66, 0,9,228,
    80,7,7, 0,8,90, 0,8,26, 0,9,148,
    84,7,67, 0,8,122, 0,8,58, 0,9,212,
    82,7,19, 0,8,106, 0,8,42, 0,9,180,
    0,8,10, 0,8,138, 0,8,74, 0,9,244,
    80,7,5, 0,8,86, 0,8,22, 192,8,0,
    83,7,51, 0,8,118, 0,8,54, 0,9,204,
    81,7,15, 0,8,102, 0,8,38, 0,9,172,
    0,8,6, 0,8,134, 0,8,70, 0,9,236,
    80,7,9, 0,8,94, 0,8,30, 0,9,156,
    84,7,99, 0,8,126, 0,8,62, 0,9,220,
    82,7,27, 0,8,110, 0,8,46, 0,9,188,
    0,8,14, 0,8,142, 0,8,78, 0,9,252,
    96,7,256, 0,8,81, 0,8,17, 85,8,131,
    82,7,31, 0,8,113, 0,8,49, 0,9,194,
    80,7,10, 0,8,97, 0,8,33, 0,9,162,
    0,8,1, 0,8,129, 0,8,65, 0,9,226,
    80,7,6, 0,8,89, 0,8,25, 0,9,146,
    83,7,59, 0,8,121, 0,8,57, 0,9,210,
    81,7,17, 0,8,105, 0,8,41, 0,9,178,
    0,8,9, 0,8,137, 0,8,73, 0,9,242,
    80,7,4, 0,8,85, 0,8,21, 80,8,258,
    83,7,43, 0,8,117, 0,8,53, 0,9,202,
    81,7,13, 0,8,101, 0,8,37, 0,9,170,
    0,8,5, 0,8,133, 0,8,69, 0,9,234,
    80,7,8, 0,8,93, 0,8,29, 0,9,154,
    84,7,83, 0,8,125, 0,8,61, 0,9,218,
    82,7,23, 0,8,109, 0,8,45, 0,9,186,
    0,8,13, 0,8,141, 0,8,77, 0,9,250,
    80,7,3, 0,8,83, 0,8,19, 85,8,195,
    83,7,35, 0,8,115, 0,8,51, 0,9,198,
    81,7,11, 0,8,99, 0,8,35, 0,9,166,
    0,8,3, 0,8,131, 0,8,67, 0,9,230,
    80,7,7, 0,8,91, 0,8,27, 0,9,150,
    84,7,67, 0,8,123, 0,8,59, 0,9,214,
    82,7,19, 0,8,107, 0,8,43, 0,9,182,
    0,8,11, 0,8,139, 0,8,75, 0,9,246,
    80,7,5, 0,8,87, 0,8,23, 192,8,0,
    83,7,51, 0,8,119, 0,8,55, 0,9,206,
    81,7,15, 0,8,103, 0,8,39, 0,9,174,
    0,8,7, 0,8,135, 0,8,71, 0,9,238,
    80,7,9, 0,8,95, 0,8,31, 0,9,158,
    84,7,99, 0,8,127, 0,8,63, 0,9,222,
    82,7,27, 0,8,111, 0,8,47, 0,9,190,
    0,8,15, 0,8,143, 0,8,79, 0,9,254,
    96,7,256, 0,8,80, 0,8,16, 84,8,115,
    82,7,31, 0,8,112, 0,8,48, 0,9,193,

    80,7,10, 0,8,96, 0,8,32, 0,9,161,
    0,8,0, 0,8,128, 0,8,64, 0,9,225,
    80,7,6, 0,8,88, 0,8,24, 0,9,145,
    83,7,59, 0,8,120, 0,8,56, 0,9,209,
    81,7,17, 0,8,104, 0,8,40, 0,9,177,
    0,8,8, 0,8,136, 0,8,72, 0,9,241,
    80,7,4, 0,8,84, 0,8,20, 85,8,227,
    83,7,43, 0,8,116, 0,8,52, 0,9,201,
    81,7,13, 0,8,100, 0,8,36, 0,9,169,
    0,8,4, 0,8,132, 0,8,68, 0,9,233,
    80,7,8, 0,8,92, 0,8,28, 0,9,153,
    84,7,83, 0,8,124, 0,8,60, 0,9,217,
    82,7,23, 0,8,108, 0,8,44, 0,9,185,
    0,8,12, 0,8,140, 0,8,76, 0,9,249,
    80,7,3, 0,8,82, 0,8,18, 85,8,163,
    83,7,35, 0,8,114, 0,8,50, 0,9,197,
    81,7,11, 0,8,98, 0,8,34, 0,9,165,
    0,8,2, 0,8,130, 0,8,66, 0,9,229,
    80,7,7, 0,8,90, 0,8,26, 0,9,149,
    84,7,67, 0,8,122, 0,8,58, 0,9,213,
    82,7,19, 0,8,106, 0,8,42, 0,9,181,
    0,8,10, 0,8,138, 0,8,74, 0,9,245,
    80,7,5, 0,8,86, 0,8,22, 192,8,0,
    83,7,51, 0,8,118, 0,8,54, 0,9,205,
    81,7,15, 0,8,102, 0,8,38, 0,9,173,
    0,8,6, 0,8,134, 0,8,70, 0,9,237,
    80,7,9, 0,8,94, 0,8,30, 0,9,157,
    84,7,99, 0,8,126, 0,8,62, 0,9,221,
    82,7,27, 0,8,110, 0,8,46, 0,9,189,
    0,8,14, 0,8,142, 0,8,78, 0,9,253,
    96,7,256, 0,8,81, 0,8,17, 85,8,131,
    82,7,31, 0,8,113, 0,8,49, 0,9,195,
    80,7,10, 0,8,97, 0,8,33, 0,9,163,
    0,8,1, 0,8,129, 0,8,65, 0,9,227,
    80,7,6, 0,8,89, 0,8,25, 0,9,147,
    83,7,59, 0,8,121, 0,8,57, 0,9,211,
    81,7,17, 0,8,105, 0,8,41, 0,9,179,
    0,8,9, 0,8,137, 0,8,73, 0,9,243,
    80,7,4, 0,8,85, 0,8,21, 80,8,258,
    83,7,43, 0,8,117, 0,8,53, 0,9,203,
    81,7,13, 0,8,101, 0,8,37, 0,9,171,
    0,8,5, 0,8,133, 0,8,69, 0,9,235,
    80,7,8, 0,8,93, 0,8,29, 0,9,155,
    84,7,83, 0,8,125, 0,8,61, 0,9,219,
    82,7,23, 0,8,109, 0,8,45, 0,9,187,
    0,8,13, 0,8,141, 0,8,77, 0,9,251,
    80,7,3, 0,8,83, 0,8,19, 85,8,195,
    83,7,35, 0,8,115, 0,8,51, 0,9,199,
    81,7,11, 0,8,99, 0,8,35, 0,9,167,
    0,8,3, 0,8,131, 0,8,67, 0,9,231,
    80,7,7, 0,8,91, 0,8,27, 0,9,151,
    84,7,67, 0,8,123, 0,8,59, 0,9,215,
    82,7,19, 0,8,107, 0,8,43, 0,9,183,
    0,8,11, 0,8,139, 0,8,75, 0,9,247,
    80,7,5, 0,8,87, 0,8,23, 192,8,0,
    83,7,51, 0,8,119, 0,8,55, 0,9,207,
    81,7,15, 0,8,103, 0,8,39, 0,9,175,
    0,8,7, 0,8,135, 0,8,71, 0,9,239,
    80,7,9, 0,8,95, 0,8,31, 0,9,159,
    84,7,99, 0,8,127, 0,8,63, 0,9,223,
    82,7,27, 0,8,111, 0,8,47, 0,9,191,
    0,8,15, 0,8,143, 0,8,79, 0,9,255
];
var fixed_td = [
    80,5,1, 87,5,257, 83,5,17, 91,5,4097,
    81,5,5, 89,5,1025, 85,5,65, 93,5,16385,
    80,5,3, 88,5,513, 84,5,33, 92,5,8193,
    82,5,9, 90,5,2049, 86,5,129, 192,5,24577,
    80,5,2, 87,5,385, 83,5,25, 91,5,6145,
    81,5,7, 89,5,1537, 85,5,97, 93,5,24577,
    80,5,4, 88,5,769, 84,5,49, 92,5,12289,
    82,5,13, 90,5,3073, 86,5,193, 192,5,24577
];

  // Tables for deflate from PKZIP's appnote.txt.
  var cplens = [ // Copy lengths for literal codes 257..285
        3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
        35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0
  ];

  // see note #13 above about 258
  var cplext = [ // Extra bits for literal codes 257..285
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
        3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 112, 112  // 112==invalid
  ];

 var cpdist = [ // Copy offsets for distance codes 0..29
        1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
        257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
        8193, 12289, 16385, 24577
  ];

  var cpdext = [ // Extra bits for distance codes
        0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
        7, 7, 8, 8, 9, 9, 10, 10, 11, 11,
        12, 12, 13, 13];

//
// ZStream.java
//

function ZStream() {
}


ZStream.prototype.inflateInit = function(w, nowrap) {
    if (!w) {
	w = DEF_WBITS;
    }
    if (nowrap) {
	nowrap = false;
    }
    this.istate = new Inflate();
    return this.istate.inflateInit(this, nowrap?-w:w);
}

ZStream.prototype.inflate = function(f) {
    if(this.istate==null) return Z_STREAM_ERROR;
    return this.istate.inflate(this, f);
}

ZStream.prototype.inflateEnd = function(){
    if(this.istate==null) return Z_STREAM_ERROR;
    var ret=istate.inflateEnd(this);
    this.istate = null;
    return ret;
}
ZStream.prototype.inflateSync = function(){
    // if(istate == null) return Z_STREAM_ERROR;
    return istate.inflateSync(this);
}
ZStream.prototype.inflateSetDictionary = function(dictionary, dictLength){
    // if(istate == null) return Z_STREAM_ERROR;
    return istate.inflateSetDictionary(this, dictionary, dictLength);
}

/*

  public int deflateInit(int level){
    return deflateInit(level, MAX_WBITS);
  }
  public int deflateInit(int level, boolean nowrap){
    return deflateInit(level, MAX_WBITS, nowrap);
  }
  public int deflateInit(int level, int bits){
    return deflateInit(level, bits, false);
  }
  public int deflateInit(int level, int bits, boolean nowrap){
    dstate=new Deflate();
    return dstate.deflateInit(this, level, nowrap?-bits:bits);
  }
  public int deflate(int flush){
    if(dstate==null){
      return Z_STREAM_ERROR;
    }
    return dstate.deflate(this, flush);
  }
  public int deflateEnd(){
    if(dstate==null) return Z_STREAM_ERROR;
    int ret=dstate.deflateEnd();
    dstate=null;
    return ret;
  }
  public int deflateParams(int level, int strategy){
    if(dstate==null) return Z_STREAM_ERROR;
    return dstate.deflateParams(this, level, strategy);
  }
  public int deflateSetDictionary (byte[] dictionary, int dictLength){
    if(dstate == null)
      return Z_STREAM_ERROR;
    return dstate.deflateSetDictionary(this, dictionary, dictLength);
  }

*/

/*
  // Flush as much pending output as possible. All deflate() output goes
  // through this function so some applications may wish to modify it
  // to avoid allocating a large strm->next_out buffer and copying into it.
  // (See also read_buf()).
  void flush_pending(){
    int len=dstate.pending;

    if(len>avail_out) len=avail_out;
    if(len==0) return;

    if(dstate.pending_buf.length<=dstate.pending_out ||
       next_out.length<=next_out_index ||
       dstate.pending_buf.length<(dstate.pending_out+len) ||
       next_out.length<(next_out_index+len)){
      System.out.println(dstate.pending_buf.length+", "+dstate.pending_out+
			 ", "+next_out.length+", "+next_out_index+", "+len);
      System.out.println("avail_out="+avail_out);
    }

    System.arraycopy(dstate.pending_buf, dstate.pending_out,
		     next_out, next_out_index, len);

    next_out_index+=len;
    dstate.pending_out+=len;
    total_out+=len;
    avail_out-=len;
    dstate.pending-=len;
    if(dstate.pending==0){
      dstate.pending_out=0;
    }
  }

  // Read a new buffer from the current input stream, update the adler32
  // and total number of bytes read.  All deflate() input goes through
  // this function so some applications may wish to modify it to avoid
  // allocating a large strm->next_in buffer and copying from it.
  // (See also flush_pending()).
  int read_buf(byte[] buf, int start, int size) {
    int len=avail_in;

    if(len>size) len=size;
    if(len==0) return 0;

    avail_in-=len;

    if(dstate.noheader==0) {
      adler=_adler.adler32(adler, next_in, next_in_index, len);
    }
    System.arraycopy(next_in, next_in_index, buf, start, len);
    next_in_index  += len;
    total_in += len;
    return len;
  }

  public void free(){
    next_in=null;
    next_out=null;
    msg=null;
    _adler=null;
  }
}
*/


//
// Inflate.java
//

function Inflate() {
    this.was = [0];
}

Inflate.prototype.inflateReset = function(z) {
    if(z == null || z.istate == null) return Z_STREAM_ERROR;
    
    z.total_in = z.total_out = 0;
    z.msg = null;
    z.istate.mode = z.istate.nowrap!=0 ? BLOCKS : METHOD;
    z.istate.blocks.reset(z, null);
    return Z_OK;
}

Inflate.prototype.inflateEnd = function(z){
    if(this.blocks != null)
      this.blocks.free(z);
    this.blocks=null;
    return Z_OK;
}

Inflate.prototype.inflateInit = function(z, w){
    z.msg = null;
    this.blocks = null;

    // handle undocumented nowrap option (no zlib header or check)
    nowrap = 0;
    if(w < 0){
      w = - w;
      nowrap = 1;
    }

    // set window size
    if(w<8 ||w>15){
      this.inflateEnd(z);
      return Z_STREAM_ERROR;
    }
    this.wbits=w;

    z.istate.blocks=new InfBlocks(z, 
				  z.istate.nowrap!=0 ? null : this,
				  1<<w);

    // reset state
    this.inflateReset(z);
    return Z_OK;
  }

Inflate.prototype.inflate = function(z, f){
    var r, b;

    if(z == null || z.istate == null || z.next_in == null)
      return Z_STREAM_ERROR;
    f = f == Z_FINISH ? Z_BUF_ERROR : Z_OK;
    r = Z_BUF_ERROR;
    while (true){
      switch (z.istate.mode){
      case METHOD:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        if(((z.istate.method = z.next_in[z.next_in_index++])&0xf)!=Z_DEFLATED){
          z.istate.mode = BAD;
          z.msg="unknown compression method";
          z.istate.marker = 5;       // can't try inflateSync
          break;
        }
        if((z.istate.method>>4)+8>z.istate.wbits){
          z.istate.mode = BAD;
          z.msg="invalid window size";
          z.istate.marker = 5;       // can't try inflateSync
          break;
        }
        z.istate.mode=FLAG;
      case FLAG:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        b = (z.next_in[z.next_in_index++])&0xff;

        if((((z.istate.method << 8)+b) % 31)!=0){
          z.istate.mode = BAD;
          z.msg = "incorrect header check";
          z.istate.marker = 5;       // can't try inflateSync
          break;
        }

        if((b&PRESET_DICT)==0){
          z.istate.mode = BLOCKS;
          break;
        }
        z.istate.mode = DICT4;
      case DICT4:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need=((z.next_in[z.next_in_index++]&0xff)<<24)&0xff000000;
        z.istate.mode=DICT3;
      case DICT3:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need+=((z.next_in[z.next_in_index++]&0xff)<<16)&0xff0000;
        z.istate.mode=DICT2;
      case DICT2:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need+=((z.next_in[z.next_in_index++]&0xff)<<8)&0xff00;
        z.istate.mode=DICT1;
      case DICT1:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need += (z.next_in[z.next_in_index++]&0xff);
        z.adler = z.istate.need;
        z.istate.mode = DICT0;
        return Z_NEED_DICT;
      case DICT0:
        z.istate.mode = BAD;
        z.msg = "need dictionary";
        z.istate.marker = 0;       // can try inflateSync
        return Z_STREAM_ERROR;
      case BLOCKS:

        r = z.istate.blocks.proc(z, r);
        if(r == Z_DATA_ERROR){
          z.istate.mode = BAD;
          z.istate.marker = 0;     // can try inflateSync
          break;
        }
        if(r == Z_OK){
          r = f;
        }
        if(r != Z_STREAM_END){
          return r;
        }
        r = f;
        z.istate.blocks.reset(z, z.istate.was);
        if(z.istate.nowrap!=0){
          z.istate.mode=DONE;
          break;
        }
        z.istate.mode=CHECK4;
      case CHECK4:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need=((z.next_in[z.next_in_index++]&0xff)<<24)&0xff000000;
        z.istate.mode=CHECK3;
      case CHECK3:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need+=((z.next_in[z.next_in_index++]&0xff)<<16)&0xff0000;
        z.istate.mode = CHECK2;
      case CHECK2:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need+=((z.next_in[z.next_in_index++]&0xff)<<8)&0xff00;
        z.istate.mode = CHECK1;
      case CHECK1:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need+=(z.next_in[z.next_in_index++]&0xff);

        if(((z.istate.was[0])) != ((z.istate.need))){
          z.istate.mode = BAD;
          z.msg = "incorrect data check";
          z.istate.marker = 5;       // can't try inflateSync
          break;
        }

        z.istate.mode = DONE;
      case DONE:
        return Z_STREAM_END;
      case BAD:
        return Z_DATA_ERROR;
      default:
        return Z_STREAM_ERROR;
      }
    }
  }


Inflate.prototype.inflateSetDictionary = function(z,  dictionary, dictLength) {
    var index=0;
    var length = dictLength;
    if(z==null || z.istate == null|| z.istate.mode != DICT0)
      return Z_STREAM_ERROR;

    if(z._adler.adler32(1, dictionary, 0, dictLength)!=z.adler){
      return Z_DATA_ERROR;
    }

    z.adler = z._adler.adler32(0, null, 0, 0);

    if(length >= (1<<z.istate.wbits)){
      length = (1<<z.istate.wbits)-1;
      index=dictLength - length;
    }
    z.istate.blocks.set_dictionary(dictionary, index, length);
    z.istate.mode = BLOCKS;
    return Z_OK;
  }

//  static private byte[] mark = {(byte)0, (byte)0, (byte)0xff, (byte)0xff};
var mark = [0, 0, 255, 255]

Inflate.prototype.inflateSync = function(z){
    var n;       // number of bytes to look at
    var p;       // pointer to bytes
    var m;       // number of marker bytes found in a row
    var r, w;   // temporaries to save total_in and total_out

    // set up
    if(z == null || z.istate == null)
      return Z_STREAM_ERROR;
    if(z.istate.mode != BAD){
      z.istate.mode = BAD;
      z.istate.marker = 0;
    }
    if((n=z.avail_in)==0)
      return Z_BUF_ERROR;
    p=z.next_in_index;
    m=z.istate.marker;

    // search
    while (n!=0 && m < 4){
      if(z.next_in[p] == mark[m]){
        m++;
      }
      else if(z.next_in[p]!=0){
        m = 0;
      }
      else{
        m = 4 - m;
      }
      p++; n--;
    }

    // restore
    z.total_in += p-z.next_in_index;
    z.next_in_index = p;
    z.avail_in = n;
    z.istate.marker = m;

    // return no joy or set up to restart on a new block
    if(m != 4){
      return Z_DATA_ERROR;
    }
    r=z.total_in;  w=z.total_out;
    this.inflateReset(z);
    z.total_in=r;  z.total_out = w;
    z.istate.mode = BLOCKS;
    return Z_OK;
}

  // Returns true if inflate is currently at the end of a block generated
  // by Z_SYNC_FLUSH or Z_FULL_FLUSH. This function is used by one PPP
  // implementation to provide an additional safety check. PPP uses Z_SYNC_FLUSH
  // but removes the length bytes of the resulting empty stored block. When
  // decompressing, PPP checks that at the end of input packet, inflate is
  // waiting for these length bytes.
Inflate.prototype.inflateSyncPoint = function(z){
    if(z == null || z.istate == null || z.istate.blocks == null)
      return Z_STREAM_ERROR;
    return z.istate.blocks.sync_point();
}


//
// InfBlocks.java
//

var INFBLOCKS_BORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function InfBlocks(z, checkfn, w) {
    this.hufts=new Int32Array(MANY*3);
    this.window=new Uint8Array(w);
    this.end=w;
    this.checkfn = checkfn;
    this.mode = IB_TYPE;
    this.reset(z, null);

    this.left = 0;            // if STORED, bytes left to copy 

    this.table = 0;           // table lengths (14 bits) 
    this.index = 0;           // index into blens (or border) 
    this.blens = null;         // bit lengths of codes 
    this.bb=new Int32Array(1); // bit length tree depth 
    this.tb=new Int32Array(1); // bit length decoding tree 

    this.codes = new InfCodes();

    this.last = 0;            // true if this block is the last block 

  // mode independent information 
    this.bitk = 0;            // bits in bit buffer 
    this.bitb = 0;            // bit buffer 
    this.read = 0;            // window read pointer 
    this.write = 0;           // window write pointer 
    this.check = 0;          // check on output 

    this.inftree=new InfTree();
}




InfBlocks.prototype.reset = function(z, c){
    if(c) c[0]=this.check;
    if(this.mode==IB_CODES){
      this.codes.free(z);
    }
    this.mode=IB_TYPE;
    this.bitk=0;
    this.bitb=0;
    this.read=this.write=0;

    if(this.checkfn)
      z.adler=this.check=z._adler.adler32(0, null, 0, 0);
  }

 InfBlocks.prototype.proc = function(z, r){
    var t;              // temporary storage
    var b;              // bit buffer
    var k;              // bits in bit buffer
    var p;              // input data pointer
    var n;              // bytes available there
    var q;              // output window write pointer
    var m;              // bytes to end of window or read pointer

    // copy input/output information to locals (UPDATE macro restores)
    {p=z.next_in_index;n=z.avail_in;b=this.bitb;k=this.bitk;}
    {q=this.write;m=(q<this.read ? this.read-q-1 : this.end-q);}

    // process input based on current state
    while(true){
      switch (this.mode){
      case IB_TYPE:

	while(k<(3)){
	  if(n!=0){
	    r=Z_OK;
	  }
	  else{
	    this.bitb=b; this.bitk=k; 
	    z.avail_in=n;
	    z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    this.write=q;
	    return this.inflate_flush(z,r);
	  };
	  n--;
	  b|=(z.next_in[p++]&0xff)<<k;
	  k+=8;
	}
	t = (b & 7);
	this.last = t & 1;

	switch (t >>> 1){
        case 0:                         // stored 
          {b>>>=(3);k-=(3);}
          t = k & 7;                    // go to byte boundary

          {b>>>=(t);k-=(t);}
          this.mode = IB_LENS;                  // get length of stored block
          break;
        case 1:                         // fixed
          {
              var bl=new Int32Array(1);
	      var bd=new Int32Array(1);
              var tl=[];
	      var td=[];

	      inflate_trees_fixed(bl, bd, tl, td, z);
              this.codes.init(bl[0], bd[0], tl[0], 0, td[0], 0, z);
          }

          {b>>>=(3);k-=(3);}

          this.mode = IB_CODES;
          break;
        case 2:                         // dynamic

          {b>>>=(3);k-=(3);}

          this.mode = IB_TABLE;
          break;
        case 3:                         // illegal

          {b>>>=(3);k-=(3);}
          this.mode = BAD;
          z.msg = "invalid block type";
          r = Z_DATA_ERROR;

	  this.bitb=b; this.bitk=k; 
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  this.write=q;
	  return this.inflate_flush(z,r);
	}
	break;
      case IB_LENS:
	while(k<(32)){
	  if(n!=0){
	    r=Z_OK;
	  }
	  else{
	    this.bitb=b; this.bitk=k; 
	    z.avail_in=n;
	    z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    this.write=q;
	    return this.inflate_flush(z,r);
	  };
	  n--;
	  b|=(z.next_in[p++]&0xff)<<k;
	  k+=8;
	}

	if ((((~b) >>> 16) & 0xffff) != (b & 0xffff)){
	  this.mode = BAD;
	  z.msg = "invalid stored block lengths";
	  r = Z_DATA_ERROR;

	  this.bitb=b; this.bitk=k; 
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  this.write=q;
	  return this.inflate_flush(z,r);
	}
	this.left = (b & 0xffff);
	b = k = 0;                       // dump bits
	this.mode = this.left!=0 ? IB_STORED : (this.last!=0 ? IB_DRY : IB_TYPE);
	break;
      case IB_STORED:
	if (n == 0){
	  this.bitb=b; this.bitk=k; 
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  write=q;
	  return this.inflate_flush(z,r);
	}

	if(m==0){
	  if(q==end&&read!=0){
	    q=0; m=(q<this.read ? this.read-q-1 : this.end-q);
	  }
	  if(m==0){
	    this.write=q; 
	    r=this.inflate_flush(z,r);
	    q=this.write; m = (q < this.read ? this.read-q-1 : this.end-q);
	    if(q==this.end && this.read != 0){
	      q=0; m = (q < this.read ? this.read-q-1 : this.end-q);
	    }
	    if(m==0){
	      this.bitb=b; this.bitk=k; 
	      z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	      this.write=q;
	      return this.inflate_flush(z,r);
	    }
	  }
	}
	r=Z_OK;

	t = this.left;
	if(t>n) t = n;
	if(t>m) t = m;
	arrayCopy(z.next_in, p, this.window, q, t);
	p += t;  n -= t;
	q += t;  m -= t;
	if ((this.left -= t) != 0)
	  break;
	this.mode = (this.last != 0 ? IB_DRY : IB_TYPE);
	break;
      case IB_TABLE:

	while(k<(14)){
	  if(n!=0){
	    r=Z_OK;
	  }
	  else{
	    this.bitb=b; this.bitk=k; 
	    z.avail_in=n;
	    z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    this.write=q;
	    return this.inflate_flush(z,r);
	  };
	  n--;
	  b|=(z.next_in[p++]&0xff)<<k;
	  k+=8;
	}

	this.table = t = (b & 0x3fff);
	if ((t & 0x1f) > 29 || ((t >> 5) & 0x1f) > 29)
	  {
	    this.mode = IB_BAD;
	    z.msg = "too many length or distance symbols";
	    r = Z_DATA_ERROR;

	    this.bitb=b; this.bitk=k; 
	    z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    this.write=q;
	    return this.inflate_flush(z,r);
	  }
	t = 258 + (t & 0x1f) + ((t >> 5) & 0x1f);
	if(this.blens==null || this.blens.length<t){
	    this.blens=new Int32Array(t);
	}
	else{
	  for(var i=0; i<t; i++){
              this.blens[i]=0;
          }
	}

	{b>>>=(14);k-=(14);}

	this.index = 0;
	mode = IB_BTREE;
      case IB_BTREE:
	while (this.index < 4 + (this.table >>> 10)){
	  while(k<(3)){
	    if(n!=0){
	      r=Z_OK;
	    }
	    else{
	      this.bitb=b; this.bitk=k; 
	      z.avail_in=n;
	      z.total_in+=p-z.next_in_index;z.next_in_index=p;
	      this.write=q;
	      return this.inflate_flush(z,r);
	    };
	    n--;
	    b|=(z.next_in[p++]&0xff)<<k;
	    k+=8;
	  }

	  this.blens[INFBLOCKS_BORDER[this.index++]] = b&7;

	  {b>>>=(3);k-=(3);}
	}

	while(this.index < 19){
	  this.blens[INFBLOCKS_BORDER[this.index++]] = 0;
	}

	this.bb[0] = 7;
	t = this.inftree.inflate_trees_bits(this.blens, this.bb, this.tb, this.hufts, z);
	if (t != Z_OK){
	  r = t;
	  if (r == Z_DATA_ERROR){
	    this.blens=null;
	    this.mode = IB_BAD;
	  }

	  this.bitb=b; this.bitk=k; 
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  write=q;
	  return this.inflate_flush(z,r);
	}

	this.index = 0;
	this.mode = IB_DTREE;
      case IB_DTREE:
	while (true){
	  t = this.table;
	  if(!(this.index < 258 + (t & 0x1f) + ((t >> 5) & 0x1f))){
	    break;
	  }

	  var h; //int[]
	  var i, j, c;

	  t = this.bb[0];

	  while(k<(t)){
	    if(n!=0){
	      r=Z_OK;
	    }
	    else{
	      this.bitb=b; this.bitk=k; 
	      z.avail_in=n;
	      z.total_in+=p-z.next_in_index;z.next_in_index=p;
	      this.write=q;
	      return this.inflate_flush(z,r);
	    };
	    n--;
	    b|=(z.next_in[p++]&0xff)<<k;
	    k+=8;
	  }

//	  if (this.tb[0]==-1){
//            dlog("null...");
//	  }

	  t=this.hufts[(this.tb[0]+(b & inflate_mask[t]))*3+1];
	  c=this.hufts[(this.tb[0]+(b & inflate_mask[t]))*3+2];

	  if (c < 16){
	    b>>>=(t);k-=(t);
	    this.blens[this.index++] = c;
	  }
	  else { // c == 16..18
	    i = c == 18 ? 7 : c - 14;
	    j = c == 18 ? 11 : 3;

	    while(k<(t+i)){
	      if(n!=0){
		r=Z_OK;
	      }
	      else{
		this.bitb=b; this.bitk=k; 
		z.avail_in=n;
		z.total_in+=p-z.next_in_index;z.next_in_index=p;
		this.write=q;
		return this.inflate_flush(z,r);
	      };
	      n--;
	      b|=(z.next_in[p++]&0xff)<<k;
	      k+=8;
	    }

	    b>>>=(t);k-=(t);

	    j += (b & inflate_mask[i]);

	    b>>>=(i);k-=(i);

	    i = this.index;
	    t = this.table;
	    if (i + j > 258 + (t & 0x1f) + ((t >> 5) & 0x1f) ||
		(c == 16 && i < 1)){
	      this.blens=null;
	      this.mode = IB_BAD;
	      z.msg = "invalid bit length repeat";
	      r = Z_DATA_ERROR;

	      this.bitb=b; this.bitk=k; 
	      z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	      this.write=q;
	      return this.inflate_flush(z,r);
	    }

	    c = c == 16 ? this.blens[i-1] : 0;
	    do{
	      this.blens[i++] = c;
	    }
	    while (--j!=0);
	    this.index = i;
	  }
	}

	this.tb[0]=-1;
	{
	    var bl=new Int32Array(1);
	    var bd=new Int32Array(1);
	    var tl=new Int32Array(1);
	    var td=new Int32Array(1);
	    bl[0] = 9;         // must be <= 9 for lookahead assumptions
	    bd[0] = 6;         // must be <= 9 for lookahead assumptions

	    t = this.table;
	    t = this.inftree.inflate_trees_dynamic(257 + (t & 0x1f), 
					      1 + ((t >> 5) & 0x1f),
					      this.blens, bl, bd, tl, td, this.hufts, z);

	    if (t != Z_OK){
	        if (t == Z_DATA_ERROR){
	            this.blens=null;
	            this.mode = BAD;
	        }
	        r = t;

	        this.bitb=b; this.bitk=k; 
	        z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	        this.write=q;
	        return this.inflate_flush(z,r);
	    }
	    this.codes.init(bl[0], bd[0], this.hufts, tl[0], this.hufts, td[0], z);
	}
	this.mode = IB_CODES;
      case IB_CODES:
	this.bitb=b; this.bitk=k;
	z.avail_in=n; z.total_in+=p-z.next_in_index;z.next_in_index=p;
	this.write=q;

	if ((r = this.codes.proc(this, z, r)) != Z_STREAM_END){
	  return this.inflate_flush(z, r);
	}
	r = Z_OK;
	this.codes.free(z);

	p=z.next_in_index; n=z.avail_in;b=this.bitb;k=this.bitk;
	q=this.write;m = (q < this.read ? this.read-q-1 : this.end-q);

	if (this.last==0){
	  this.mode = IB_TYPE;
	  break;
	}
	this.mode = IB_DRY;
      case IB_DRY:
	this.write=q; 
	r = this.inflate_flush(z, r); 
	q=this.write; m = (q < this.read ? this.read-q-1 : this.end-q);
	if (this.read != this.write){
	  this.bitb=b; this.bitk=k; 
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  this.write=q;
	  return this.inflate_flush(z, r);
	}
	mode = DONE;
      case IB_DONE:
	r = Z_STREAM_END;

	this.bitb=b; this.bitk=k; 
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	this.write=q;
	return this.inflate_flush(z, r);
      case IB_BAD:
	r = Z_DATA_ERROR;

	this.bitb=b; this.bitk=k; 
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	this.write=q;
	return this.inflate_flush(z, r);

      default:
	r = Z_STREAM_ERROR;

	this.bitb=b; this.bitk=k; 
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	this.write=q;
	return this.inflate_flush(z, r);
      }
    }
  }

InfBlocks.prototype.free = function(z){
    this.reset(z, null);
    this.window=null;
    this.hufts=null;
}

InfBlocks.prototype.set_dictionary = function(d, start, n){
    arrayCopy(d, start, window, 0, n);
    this.read = this.write = n;
}

  // Returns true if inflate is currently at the end of a block generated
  // by Z_SYNC_FLUSH or Z_FULL_FLUSH. 
InfBlocks.prototype.sync_point = function(){
    return this.mode == IB_LENS;
}

  // copy as much as possible from the sliding window to the output area
InfBlocks.prototype.inflate_flush = function(z, r){
    var n;
    var p;
    var q;

    // local copies of source and destination pointers
    p = z.next_out_index;
    q = this.read;

    // compute number of bytes to copy as far as end of window
    n = ((q <= this.write ? this.write : this.end) - q);
    if (n > z.avail_out) n = z.avail_out;
    if (n!=0 && r == Z_BUF_ERROR) r = Z_OK;

    // update counters
    z.avail_out -= n;
    z.total_out += n;

    // update check information
    if(this.checkfn != null)
      z.adler=this.check=z._adler.adler32(this.check, this.window, q, n);

    // copy as far as end of window
    arrayCopy(this.window, q, z.next_out, p, n);
    p += n;
    q += n;

    // see if more to copy at beginning of window
    if (q == this.end){
      // wrap pointers
      q = 0;
      if (this.write == this.end)
        this.write = 0;

      // compute bytes to copy
      n = this.write - q;
      if (n > z.avail_out) n = z.avail_out;
      if (n!=0 && r == Z_BUF_ERROR) r = Z_OK;

      // update counters
      z.avail_out -= n;
      z.total_out += n;

      // update check information
      if(this.checkfn != null)
	z.adler=this.check=z._adler.adler32(this.check, this.window, q, n);

      // copy
      arrayCopy(this.window, q, z.next_out, p, n);
      p += n;
      q += n;
    }

    // update pointers
    z.next_out_index = p;
    this.read = q;

    // done
    return r;
  }

//
// InfCodes.java
//

var IC_START=0;  // x: set up for LEN
var IC_LEN=1;    // i: get length/literal/eob next
var IC_LENEXT=2; // i: getting length extra (have base)
var IC_DIST=3;   // i: get distance next
var IC_DISTEXT=4;// i: getting distance extra
var IC_COPY=5;   // o: copying bytes in window, waiting for space
var IC_LIT=6;    // o: got literal, waiting for output space
var IC_WASH=7;   // o: got eob, possibly still output waiting
var IC_END=8;    // x: got eob and all data flushed
var IC_BADCODE=9;// x: got error

function InfCodes() {
}

InfCodes.prototype.init = function(bl, bd, tl, tl_index, td, td_index, z) {
    this.mode=IC_START;
    this.lbits=bl;
    this.dbits=bd;
    this.ltree=tl;
    this.ltree_index=tl_index;
    this.dtree = td;
    this.dtree_index=td_index;
    this.tree=null;
}

InfCodes.prototype.proc = function(s, z, r){ 
    var j;              // temporary storage
    var t;              // temporary pointer (int[])
    var tindex;         // temporary pointer
    var e;              // extra bits or operation
    var b=0;            // bit buffer
    var k=0;            // bits in bit buffer
    var p=0;            // input data pointer
    var n;              // bytes available there
    var q;              // output window write pointer
    var m;              // bytes to end of window or read pointer
    var f;              // pointer to copy strings from

    // copy input/output information to locals (UPDATE macro restores)
    p=z.next_in_index;n=z.avail_in;b=s.bitb;k=s.bitk;
    q=s.write;m=q<s.read?s.read-q-1:s.end-q;

    // process input and output based on current state
    while (true){
      switch (this.mode){
	// waiting for "i:"=input, "o:"=output, "x:"=nothing
      case IC_START:         // x: set up for LEN
	if (m >= 258 && n >= 10){

	  s.bitb=b;s.bitk=k;
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  s.write=q;
	  r = this.inflate_fast(this.lbits, this.dbits, 
			   this.ltree, this.ltree_index, 
			   this.dtree, this.dtree_index,
			   s, z);

	  p=z.next_in_index;n=z.avail_in;b=s.bitb;k=s.bitk;
	  q=s.write;m=q<s.read?s.read-q-1:s.end-q;

	  if (r != Z_OK){
	    this.mode = r == Z_STREAM_END ? IC_WASH : IC_BADCODE;
	    break;
	  }
	}
	this.need = this.lbits;
	this.tree = this.ltree;
	this.tree_index=this.ltree_index;

	this.mode = IC_LEN;
      case IC_LEN:           // i: get length/literal/eob next
	j = this.need;

	while(k<(j)){
	  if(n!=0)r=Z_OK;
	  else{

	    s.bitb=b;s.bitk=k;
	    z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    s.write=q;
	    return s.inflate_flush(z,r);
	  }
	  n--;
	  b|=(z.next_in[p++]&0xff)<<k;
	  k+=8;
	}

	tindex=(this.tree_index+(b&inflate_mask[j]))*3;

	b>>>=(this.tree[tindex+1]);
	k-=(this.tree[tindex+1]);

	e=this.tree[tindex];

	if(e == 0){               // literal
	  this.lit = this.tree[tindex+2];
	  this.mode = IC_LIT;
	  break;
	}
	if((e & 16)!=0 ){          // length
	  this.get = e & 15;
	  this.len = this.tree[tindex+2];
	  this.mode = IC_LENEXT;
	  break;
	}
	if ((e & 64) == 0){        // next table
	  this.need = e;
	  this.tree_index = tindex/3 + this.tree[tindex+2];
	  break;
	}
	if ((e & 32)!=0){               // end of block
	  this.mode = IC_WASH;
	  break;
	}
	this.mode = IC_BADCODE;        // invalid code
	z.msg = "invalid literal/length code";
	r = Z_DATA_ERROR;

	s.bitb=b;s.bitk=k;
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	s.write=q;
	return s.inflate_flush(z,r);

      case IC_LENEXT:        // i: getting length extra (have base)
	j = this.get;

	while(k<(j)){
	  if(n!=0)r=Z_OK;
	  else{

	    s.bitb=b;s.bitk=k;
	    z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    s.write=q;
	    return s.inflate_flush(z,r);
	  }
	  n--; b|=(z.next_in[p++]&0xff)<<k;
	  k+=8;
	}

	this.len += (b & inflate_mask[j]);

	b>>=j;
	k-=j;

	this.need = this.dbits;
	this.tree = this.dtree;
	this.tree_index = this.dtree_index;
	this.mode = IC_DIST;
      case IC_DIST:          // i: get distance next
	j = this.need;

	while(k<(j)){
	  if(n!=0)r=Z_OK;
	  else{

	    s.bitb=b;s.bitk=k;
	    z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    s.write=q;
	    return s.inflate_flush(z,r);
	  }
	  n--; b|=(z.next_in[p++]&0xff)<<k;
	  k+=8;
	}

	tindex=(this.tree_index+(b & inflate_mask[j]))*3;

	b>>=this.tree[tindex+1];
	k-=this.tree[tindex+1];

	e = (this.tree[tindex]);
	if((e & 16)!=0){               // distance
	  this.get = e & 15;
	  this.dist = this.tree[tindex+2];
	  this.mode = IC_DISTEXT;
	  break;
	}
	if ((e & 64) == 0){        // next table
	  this.need = e;
	  this.tree_index = tindex/3 + this.tree[tindex+2];
	  break;
	}
	this.mode = IC_BADCODE;        // invalid code
	z.msg = "invalid distance code";
	r = Z_DATA_ERROR;

	s.bitb=b;s.bitk=k;
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	s.write=q;
	return s.inflate_flush(z,r);

      case IC_DISTEXT:       // i: getting distance extra
	j = this.get;

	while(k<(j)){
	  if(n!=0)r=Z_OK;
	  else{

	    s.bitb=b;s.bitk=k;
	    z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    s.write=q;
	    return s.inflate_flush(z,r);
	  }
	  n--; b|=(z.next_in[p++]&0xff)<<k;
	  k+=8;
	}

	this.dist += (b & inflate_mask[j]);

	b>>=j;
	k-=j;

	this.mode = IC_COPY;
      case IC_COPY:          // o: copying bytes in window, waiting for space
        f = q - this.dist;
        while(f < 0){     // modulo window size-"while" instead
          f += s.end;     // of "if" handles invalid distances
	}
	while (this.len!=0){

	  if(m==0){
	    if(q==s.end&&s.read!=0){q=0;m=q<s.read?s.read-q-1:s.end-q;}
	    if(m==0){
	      s.write=q; r=s.inflate_flush(z,r);
	      q=s.write;m=q<s.read?s.read-q-1:s.end-q;

	      if(q==s.end&&s.read!=0){q=0;m=q<s.read?s.read-q-1:s.end-q;}

	      if(m==0){
		s.bitb=b;s.bitk=k;
		z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
		s.write=q;
		return s.inflate_flush(z,r);
	      }  
	    }
	  }

	  s.window[q++]=s.window[f++]; m--;

	  if (f == s.end)
            f = 0;
	  this.len--;
	}
	this.mode = IC_START;
	break;
      case IC_LIT:           // o: got literal, waiting for output space
	if(m==0){
	  if(q==s.end&&s.read!=0){q=0;m=q<s.read?s.read-q-1:s.end-q;}
	  if(m==0){
	    s.write=q; r=s.inflate_flush(z,r);
	    q=s.write;m=q<s.read?s.read-q-1:s.end-q;

	    if(q==s.end&&s.read!=0){q=0;m=q<s.read?s.read-q-1:s.end-q;}
	    if(m==0){
	      s.bitb=b;s.bitk=k;
	      z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	      s.write=q;
	      return s.inflate_flush(z,r);
	    }
	  }
	}
	r=Z_OK;

	s.window[q++]=this.lit; m--;

	this.mode = IC_START;
	break;
      case IC_WASH:           // o: got eob, possibly more output
	if (k > 7){        // return unused byte, if any
	  k -= 8;
	  n++;
	  p--;             // can always return one
	}

	s.write=q; r=s.inflate_flush(z,r);
	q=s.write;m=q<s.read?s.read-q-1:s.end-q;

	if (s.read != s.write){
	  s.bitb=b;s.bitk=k;
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  s.write=q;
	  return s.inflate_flush(z,r);
	}
	this.mode = IC_END;
      case IC_END:
	r = Z_STREAM_END;
	s.bitb=b;s.bitk=k;
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	s.write=q;
	return s.inflate_flush(z,r);

      case IC_BADCODE:       // x: got error

	r = Z_DATA_ERROR;

	s.bitb=b;s.bitk=k;
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	s.write=q;
	return s.inflate_flush(z,r);

      default:
	r = Z_STREAM_ERROR;

	s.bitb=b;s.bitk=k;
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	s.write=q;
	return s.inflate_flush(z,r);
      }
    }
  }

InfCodes.prototype.free = function(z){
    //  ZFREE(z, c);
}

  // Called with number of bytes left to write in window at least 258
  // (the maximum string length) and number of input bytes available
  // at least ten.  The ten bytes are six bytes for the longest length/
  // distance pair plus four bytes for overloading the bit buffer.

InfCodes.prototype.inflate_fast = function(bl, bd, tl, tl_index, td, td_index, s, z) {
    var t;                // temporary pointer
    var   tp;             // temporary pointer (int[])
    var tp_index;         // temporary pointer
    var e;                // extra bits or operation
    var b;                // bit buffer
    var k;                // bits in bit buffer
    var p;                // input data pointer
    var n;                // bytes available there
    var q;                // output window write pointer
    var m;                // bytes to end of window or read pointer
    var ml;               // mask for literal/length tree
    var md;               // mask for distance tree
    var c;                // bytes to copy
    var d;                // distance back to copy from
    var r;                // copy source pointer

    var tp_index_t_3;     // (tp_index+t)*3

    // load input, output, bit values
    p=z.next_in_index;n=z.avail_in;b=s.bitb;k=s.bitk;
    q=s.write;m=q<s.read?s.read-q-1:s.end-q;

    // initialize masks
    ml = inflate_mask[bl];
    md = inflate_mask[bd];

    // do until not enough input or output space for fast loop
    do {                          // assume called with m >= 258 && n >= 10
      // get literal/length code
      while(k<(20)){              // max bits for literal/length code
	n--;
	b|=(z.next_in[p++]&0xff)<<k;k+=8;
      }

      t= b&ml;
      tp=tl; 
      tp_index=tl_index;
      tp_index_t_3=(tp_index+t)*3;
      if ((e = tp[tp_index_t_3]) == 0){
	b>>=(tp[tp_index_t_3+1]); k-=(tp[tp_index_t_3+1]);

	s.window[q++] = tp[tp_index_t_3+2];
	m--;
	continue;
      }
      do {

	b>>=(tp[tp_index_t_3+1]); k-=(tp[tp_index_t_3+1]);

	if((e&16)!=0){
	  e &= 15;
	  c = tp[tp_index_t_3+2] + (b & inflate_mask[e]);

	  b>>=e; k-=e;

	  // decode distance base of block to copy
	  while(k<(15)){           // max bits for distance code
	    n--;
	    b|=(z.next_in[p++]&0xff)<<k;k+=8;
	  }

	  t= b&md;
	  tp=td;
	  tp_index=td_index;
          tp_index_t_3=(tp_index+t)*3;
	  e = tp[tp_index_t_3];

	  do {

	    b>>=(tp[tp_index_t_3+1]); k-=(tp[tp_index_t_3+1]);

	    if((e&16)!=0){
	      // get extra bits to add to distance base
	      e &= 15;
	      while(k<(e)){         // get extra bits (up to 13)
		n--;
		b|=(z.next_in[p++]&0xff)<<k;k+=8;
	      }

	      d = tp[tp_index_t_3+2] + (b&inflate_mask[e]);

	      b>>=(e); k-=(e);

	      // do the copy
	      m -= c;
	      if (q >= d){                // offset before dest
		//  just copy
		r=q-d;
		if(q-r>0 && 2>(q-r)){           
		  s.window[q++]=s.window[r++]; // minimum count is three,
		  s.window[q++]=s.window[r++]; // so unroll loop a little
		  c-=2;
		}
		else{
		  s.window[q++]=s.window[r++]; // minimum count is three,
		  s.window[q++]=s.window[r++]; // so unroll loop a little
		  c-=2;
		}
	      }
	      else{                  // else offset after destination
                r=q-d;
                do{
                  r+=s.end;          // force pointer in window
                }while(r<0);         // covers invalid distances
		e=s.end-r;
		if(c>e){             // if source crosses,
		  c-=e;              // wrapped copy
		  if(q-r>0 && e>(q-r)){           
		    do{s.window[q++] = s.window[r++];}
		    while(--e!=0);
		  }
		  else{
		    arrayCopy(s.window, r, s.window, q, e);
		    q+=e; r+=e; e=0;
		  }
		  r = 0;                  // copy rest from start of window
		}

	      }

	      // copy all or what's left
              do{s.window[q++] = s.window[r++];}
		while(--c!=0);
	      break;
	    }
	    else if((e&64)==0){
	      t+=tp[tp_index_t_3+2];
	      t+=(b&inflate_mask[e]);
	      tp_index_t_3=(tp_index+t)*3;
	      e=tp[tp_index_t_3];
	    }
	    else{
	      z.msg = "invalid distance code";

	      c=z.avail_in-n;c=(k>>3)<c?k>>3:c;n+=c;p-=c;k-=c<<3;

	      s.bitb=b;s.bitk=k;
	      z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	      s.write=q;

	      return Z_DATA_ERROR;
	    }
	  }
	  while(true);
	  break;
	}

	if((e&64)==0){
	  t+=tp[tp_index_t_3+2];
	  t+=(b&inflate_mask[e]);
	  tp_index_t_3=(tp_index+t)*3;
	  if((e=tp[tp_index_t_3])==0){

	    b>>=(tp[tp_index_t_3+1]); k-=(tp[tp_index_t_3+1]);

	    s.window[q++]=tp[tp_index_t_3+2];
	    m--;
	    break;
	  }
	}
	else if((e&32)!=0){

	  c=z.avail_in-n;c=(k>>3)<c?k>>3:c;n+=c;p-=c;k-=c<<3;
 
	  s.bitb=b;s.bitk=k;
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  s.write=q;

	  return Z_STREAM_END;
	}
	else{
	  z.msg="invalid literal/length code";

	  c=z.avail_in-n;c=(k>>3)<c?k>>3:c;n+=c;p-=c;k-=c<<3;

	  s.bitb=b;s.bitk=k;
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  s.write=q;

	  return Z_DATA_ERROR;
	}
      } 
      while(true);
    } 
    while(m>=258 && n>= 10);

    // not enough input or output--restore pointers and return
    c=z.avail_in-n;c=(k>>3)<c?k>>3:c;n+=c;p-=c;k-=c<<3;

    s.bitb=b;s.bitk=k;
    z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
    s.write=q;

    return Z_OK;
}

//
// InfTree.java
//

function InfTree() {
}

InfTree.prototype.huft_build = function(b, bindex, n, s, d, e, t, m, hp, hn, v) {

    // Given a list of code lengths and a maximum table size, make a set of
    // tables to decode that set of codes.  Return Z_OK on success, Z_BUF_ERROR
    // if the given code set is incomplete (the tables are still built in this
    // case), Z_DATA_ERROR if the input is invalid (an over-subscribed set of
    // lengths), or Z_MEM_ERROR if not enough memory.

    var a;                       // counter for codes of length k
    var f;                       // i repeats in table every f entries
    var g;                       // maximum code length
    var h;                       // table level
    var i;                       // counter, current code
    var j;                       // counter
    var k;                       // number of bits in current code
    var l;                       // bits per table (returned in m)
    var mask;                    // (1 << w) - 1, to avoid cc -O bug on HP
    var p;                       // pointer into c[], b[], or v[]
    var q;                       // points to current table
    var w;                       // bits before this table == (l * h)
    var xp;                      // pointer into x
    var y;                       // number of dummy codes added
    var z;                       // number of entries in current table

    // Generate counts for each bit length

    p = 0; i = n;
    do {
      this.c[b[bindex+p]]++; p++; i--;   // assume all entries <= BMAX
    }while(i!=0);

    if(this.c[0] == n){                // null input--all zero length codes
      t[0] = -1;
      m[0] = 0;
      return Z_OK;
    }

    // Find minimum and maximum length, bound *m by those
    l = m[0];
    for (j = 1; j <= BMAX; j++)
      if(this.c[j]!=0) break;
    k = j;                        // minimum code length
    if(l < j){
      l = j;
    }
    for (i = BMAX; i!=0; i--){
      if(this.c[i]!=0) break;
    }
    g = i;                        // maximum code length
    if(l > i){
      l = i;
    }
    m[0] = l;

    // Adjust last length count to fill out codes, if needed
    for (y = 1 << j; j < i; j++, y <<= 1){
      if ((y -= this.c[j]) < 0){
        return Z_DATA_ERROR;
      }
    }
    if ((y -= this.c[i]) < 0){
      return Z_DATA_ERROR;
    }
    this.c[i] += y;

    // Generate starting offsets into the value table for each length
    this.x[1] = j = 0;
    p = 1;  xp = 2;
    while (--i!=0) {                 // note that i == g from above
      this.x[xp] = (j += this.c[p]);
      xp++;
      p++;
    }

    // Make a table of values in order of bit lengths
    i = 0; p = 0;
    do {
      if ((j = b[bindex+p]) != 0){
        this.v[this.x[j]++] = i;
      }
      p++;
    }
    while (++i < n);
    n = this.x[g];                     // set n to length of v

    // Generate the Huffman codes and for each, make the table entries
    this.x[0] = i = 0;                 // first Huffman code is zero
    p = 0;                        // grab values in bit order
    h = -1;                       // no tables yet--level -1
    w = -l;                       // bits decoded == (l * h)
    this.u[0] = 0;                     // just to keep compilers happy
    q = 0;                        // ditto
    z = 0;                        // ditto

    // go through the bit lengths (k already is bits in shortest code)
    for (; k <= g; k++){
      a = this.c[k];
      while (a--!=0){
	// here i is the Huffman code of length k bits for value *p
	// make tables up to required level
        while (k > w + l){
          h++;
          w += l;                 // previous table always l bits
	  // compute minimum size table less than or equal to l bits
          z = g - w;
          z = (z > l) ? l : z;        // table size upper limit
          if((f=1<<(j=k-w))>a+1){     // try a k-w bit table
                                      // too few codes for k-w bit table
            f -= a + 1;               // deduct codes from patterns left
            xp = k;
            if(j < z){
              while (++j < z){        // try smaller tables up to z bits
                if((f <<= 1) <= this.c[++xp])
                  break;              // enough codes to use up j bits
                f -= this.c[xp];           // else deduct codes from patterns
              }
	    }
          }
          z = 1 << j;                 // table entries for j-bit table

	  // allocate new table
          if (this.hn[0] + z > MANY){       // (note: doesn't matter for fixed)
            return Z_DATA_ERROR;       // overflow of MANY
          }
          this.u[h] = q = /*hp+*/ this.hn[0];   // DEBUG
          this.hn[0] += z;
 
	  // connect to last table, if there is one
	  if(h!=0){
            this.x[h]=i;           // save pattern for backing up
            this.r[0]=j;     // bits in this table
            this.r[1]=l;     // bits to dump before this table
            j=i>>>(w - l);
            this.r[2] = (q - this.u[h-1] - j);               // offset to this table
            arrayCopy(this.r, 0, hp, (this.u[h-1]+j)*3, 3); // connect to last table
          }
          else{
            t[0] = q;               // first table is returned result
	  }
        }

	// set up table entry in r
        this.r[1] = (k - w);
        if (p >= n){
          this.r[0] = 128 + 64;      // out of values--invalid code
	}
        else if (v[p] < s){
          this.r[0] = (this.v[p] < 256 ? 0 : 32 + 64);  // 256 is end-of-block
          this.r[2] = this.v[p++];          // simple code is just the value
        }
        else{
          this.r[0]=(e[this.v[p]-s]+16+64); // non-simple--look up in lists
          this.r[2]=d[this.v[p++] - s];
        }

        // fill code-like entries with r
        f=1<<(k-w);
        for (j=i>>>w;j<z;j+=f){
          arrayCopy(this.r, 0, hp, (q+j)*3, 3);
	}

	// backwards increment the k-bit code i
        for (j = 1 << (k - 1); (i & j)!=0; j >>>= 1){
          i ^= j;
	}
        i ^= j;

	// backup over finished tables
        mask = (1 << w) - 1;      // needed on HP, cc -O bug
        while ((i & mask) != this.x[h]){
          h--;                    // don't need to update q
          w -= l;
          mask = (1 << w) - 1;
        }
      }
    }
    // Return Z_BUF_ERROR if we were given an incomplete table
    return y != 0 && g != 1 ? Z_BUF_ERROR : Z_OK;
}

InfTree.prototype.inflate_trees_bits = function(c, bb, tb, hp, z) {
    var result;
    this.initWorkArea(19);
    this.hn[0]=0;
    result = this.huft_build(c, 0, 19, 19, null, null, tb, bb, hp, this.hn, this.v);

    if(result == Z_DATA_ERROR){
      z.msg = "oversubscribed dynamic bit lengths tree";
    }
    else if(result == Z_BUF_ERROR || bb[0] == 0){
      z.msg = "incomplete dynamic bit lengths tree";
      result = Z_DATA_ERROR;
    }
    return result;
}

InfTree.prototype.inflate_trees_dynamic = function(nl, nd, c, bl, bd, tl, td, hp, z) {
    var result;

    // build literal/length tree
    this.initWorkArea(288);
    this.hn[0]=0;
    result = this.huft_build(c, 0, nl, 257, cplens, cplext, tl, bl, hp, this.hn, this.v);
    if (result != Z_OK || bl[0] == 0){
      if(result == Z_DATA_ERROR){
        z.msg = "oversubscribed literal/length tree";
      }
      else if (result != Z_MEM_ERROR){
        z.msg = "incomplete literal/length tree";
        result = Z_DATA_ERROR;
      }
      return result;
    }

    // build distance tree
    this.initWorkArea(288);
    result = this.huft_build(c, nl, nd, 0, cpdist, cpdext, td, bd, hp, this.hn, this.v);

    if (result != Z_OK || (bd[0] == 0 && nl > 257)){
      if (result == Z_DATA_ERROR){
        z.msg = "oversubscribed distance tree";
      }
      else if (result == Z_BUF_ERROR) {
        z.msg = "incomplete distance tree";
        result = Z_DATA_ERROR;
      }
      else if (result != Z_MEM_ERROR){
        z.msg = "empty distance tree with lengths";
        result = Z_DATA_ERROR;
      }
      return result;
    }

    return Z_OK;
}
/*
  static int inflate_trees_fixed(int[] bl,  //literal desired/actual bit depth
                                 int[] bd,  //distance desired/actual bit depth
                                 int[][] tl,//literal/length tree result
                                 int[][] td,//distance tree result 
                                 ZStream z  //for memory allocation
				 ){

*/

function inflate_trees_fixed(bl, bd, tl, td, z) {
    bl[0]=fixed_bl;
    bd[0]=fixed_bd;
    tl[0]=fixed_tl;
    td[0]=fixed_td;
    return Z_OK;
}

InfTree.prototype.initWorkArea = function(vsize){
    if(this.hn==null){
        this.hn=new Int32Array(1);
        this.v=new Int32Array(vsize);
        this.c=new Int32Array(BMAX+1);
        this.r=new Int32Array(3);
        this.u=new Int32Array(BMAX);
        this.x=new Int32Array(BMAX+1);
    }
    if(this.v.length<vsize){ 
        this.v=new Int32Array(vsize); 
    }
    for(var i=0; i<vsize; i++){this.v[i]=0;}
    for(var i=0; i<BMAX+1; i++){this.c[i]=0;}
    for(var i=0; i<3; i++){this.r[i]=0;}
//  for(int i=0; i<BMAX; i++){u[i]=0;}
    arrayCopy(this.c, 0, this.u, 0, BMAX);
//  for(int i=0; i<BMAX+1; i++){x[i]=0;}
    arrayCopy(this.c, 0, this.x, 0, BMAX+1);
}

var testArray = new Uint8Array(1);
var hasSubarray = (typeof testArray.subarray === 'function');
var hasSlice = false; /* (typeof testArray.slice === 'function'); */ // Chrome slice performance is so dire that we're currently not using it...

function arrayCopy(src, srcOffset, dest, destOffset, count) {
    if (count == 0) {
        return;
    } 
    if (!src) {
        throw "Undef src";
    } else if (!dest) {
        throw "Undef dest";
    }

    if (srcOffset == 0 && count == src.length) {
        arrayCopy_fast(src, dest, destOffset);
    } else if (hasSubarray) {
        arrayCopy_fast(src.subarray(srcOffset, srcOffset + count), dest, destOffset); 
    } else if (src.BYTES_PER_ELEMENT == 1 && count > 100) {
        arrayCopy_fast(new Uint8Array(src.buffer, src.byteOffset + srcOffset, count), dest, destOffset);
    } else { 
        arrayCopy_slow(src, srcOffset, dest, destOffset, count);
    }

}

function arrayCopy_slow(src, srcOffset, dest, destOffset, count) {

    // dlog('_slow call: srcOffset=' + srcOffset + '; destOffset=' + destOffset + '; count=' + count);

     for (var i = 0; i < count; ++i) {
        dest[destOffset + i] = src[srcOffset + i];
    }
}

function arrayCopy_fast(src, dest, destOffset) {
    dest.set(src, destOffset);
}


  // largest prime smaller than 65536
var ADLER_BASE=65521; 
  // NMAX is the largest n such that 255n(n+1)/2 + (n+1)(BASE-1) <= 2^32-1
var ADLER_NMAX=5552;

function adler32(adler, /* byte[] */ buf,  index, len){
    if(buf == null){ return 1; }

    var s1=adler&0xffff;
    var s2=(adler>>16)&0xffff;
    var k;

    while(len > 0) {
      k=len<ADLER_NMAX?len:ADLER_NMAX;
      len-=k;
      while(k>=16){
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        k-=16;
      }
      if(k!=0){
        do{
          s1+=buf[index++]&0xff; s2+=s1;
        }
        while(--k!=0);
      }
      s1%=ADLER_BASE;
      s2%=ADLER_BASE;
    }
    return (s2<<16)|s1;
}



function jszlib_inflate_buffer(buffer, start, length, afterUncOffset) {
    if (!start) {
        buffer = new Uint8Array(buffer);
    } else if (!length) {
        buffer = new Uint8Array(buffer, start, buffer.byteLength - start);
    } else {
        buffer = new Uint8Array(buffer, start, length);
    }

    var z = new ZStream();
    z.inflateInit(DEF_WBITS, true);
    z.next_in = buffer;
    z.next_in_index = 0;
    z.avail_in = buffer.length;

    var oBlockList = [];
    var totalSize = 0;
    while (true) {
        var obuf = new Uint8Array(32000);
        z.next_out = obuf;
        z.next_out_index = 0;
        z.avail_out = obuf.length;
        var status = z.inflate(Z_NO_FLUSH);
        if (status != Z_OK && status != Z_STREAM_END && status != Z_BUF_ERROR) {
            throw z.msg;
        }
        if (z.avail_out != 0) {
            var newob = new Uint8Array(obuf.length - z.avail_out);
            arrayCopy(obuf, 0, newob, 0, (obuf.length - z.avail_out));
            obuf = newob;
        }
        oBlockList.push(obuf);
        totalSize += obuf.length;
        if (status == Z_STREAM_END || status == Z_BUF_ERROR) {
            break;
        }
    }

    if (afterUncOffset) {
        afterUncOffset[0] = (start || 0) + z.next_in_index;
    }

    if (oBlockList.length == 1) {
        return oBlockList[0].buffer;
    } else {
        var out = new Uint8Array(totalSize);
        var cursor = 0;
        for (var i = 0; i < oBlockList.length; ++i) {
            var b = oBlockList[i];
            arrayCopy(b, 0, out, cursor, b.length);
            cursor += b.length;
        }
        return out.buffer;
    }
}

if (typeof(module) !== 'undefined') {
  module.exports = {
    inflateBuffer: jszlib_inflate_buffer,
    arrayCopy: arrayCopy
  };
}

},{}]},{},[2])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJqcy9iYW0tcmVjb3JkLnRzIiwianMvYmFtLnRzIiwianMvYmd6Zi50cyIsImpzL2Jpbi50cyIsImpzL2NodW5rLnRzIiwianMvc2hhMS50cyIsImpzL3V0aWxzLnRzIiwianMvdm9iLnRzIiwibm9kZV9tb2R1bGVzL2pzemxpYi9qcy9pbmZsYXRlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7QUNBQTtJQUFBO0lBWUEsQ0FBQztJQUFELGdCQUFDO0FBQUQsQ0FaQSxBQVlDLElBQUE7Ozs7OztBQ1pELDZCQUF3QixDQUFBLGtCQUFrQjtBQUMxQywrQkFBMEI7QUFDMUIsNkJBQWtFO0FBQ2xFLGlDQUE0QjtBQUM1QiwyQ0FBcUM7QUFFckM7SUFBQTtJQXlCQSxDQUFDO0lBeEJRLGtCQUFZLEdBQW5CLFVBQW9CLElBQVksRUFBRSxFQUFjLEVBQUcsTUFBYztRQUMvRCxJQUFNLFFBQVEsR0FBUTtZQUNwQixHQUFHLEVBQUUsa0JBQVksQ0FBQyxPQUFPO1lBQ3pCLEtBQUssRUFBRSxrQkFBWSxDQUFDLFNBQVM7WUFDN0IsS0FBSyxFQUFFLGtCQUFZLENBQUMsU0FBUztZQUM3QixJQUFJLEVBQUUsa0JBQVksQ0FBQyxRQUFRO1lBQzNCLEtBQUssRUFBRSxrQkFBWSxDQUFDLFNBQVM7WUFDN0IsS0FBSyxFQUFFLGtCQUFZLENBQUMsU0FBUztTQUM5QixDQUFDO1FBRUYsRUFBRSxDQUFBLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUEsQ0FBQztZQUNqQixNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUUsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUNwQyxDQUFDO1FBQUMsSUFBSSxDQUFDLENBQUM7WUFDTixNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixDQUFDLENBQUM7UUFDekMsQ0FBQztJQUNILENBQUM7SUFFTSx5QkFBbUIsR0FBMUIs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QUFFLElBQUksR0FBRyxJQUFJLEVBQUUsQ0FBQztZQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUNyRSxFQUFFLENBQUMsQ0FBQyxHQUFHLElBQUksRUFBRSxJQUFJLEdBQUcsSUFBSSxFQUFFLENBQUM7WUFBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxHQUFHLElBQUksRUFBRSxDQUFDLENBQUM7UUFDckUsRUFBRSxDQUFDLENBQUMsR0FBRyxJQUFJLEVBQUUsSUFBSSxHQUFHLElBQUksRUFBRSxDQUFDO1lBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ3BFLEVBQUUsQ0FBQyxDQUFDLEdBQUcsSUFBSSxFQUFFLElBQUksR0FBRyxJQUFJLEVBQUUsQ0FBQztZQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUNwRSxFQUFFLENBQUMsQ0FBQyxHQUFHLElBQUksRUFBRSxJQUFJLEdBQUcsSUFBSSxFQUFFLENBQUM7WUFBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxHQUFHLElBQUksRUFBRSxDQUFDLENBQUM7UUFDcEUsTUFBTSxDQUFDLENBQUMsQ0FBQztJQUNYLENBQUM7SUFFRCxvRkFBb0Y7SUFDckUsZ0JBQVEsR0FBdkIsVUFBd0IsR0FBVyxFQUFFLEdBQVc7UUFDOUMsSUFBSSxDQUFTLENBQUM7UUFDZCxJQUFNLElBQUksR0FBYSxFQUFFLENBQUM7UUFDMUIsRUFBRSxHQUFHLENBQUM7UUFDTixJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2IsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztZQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDbEUsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztZQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDbEUsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLEdBQUcsSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsR0FBRyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztZQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDcEUsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDLEdBQUcsSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksR0FBRyxHQUFHLENBQUMsR0FBRyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztZQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdEUsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksSUFBSSxHQUFHLENBQUMsR0FBRyxJQUFJLEVBQUUsQ0FBQyxFQUFF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LEVBQUUsSUFBSSxDQUFDLENBQUM7WUFDM0IsQ0FBQyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFDO1lBQzNCLENBQUMsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUM3QixDQUFDO1FBQ0QsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztJQUNsQyxDQUFDO0lBRUQ7O01BRUU7SUFDSyxZQUFPLEdBQWQsVUFBZSxDQUFTO1FBQ3RCLE1BQU0sQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDcEQsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztJQUN4QyxDQUFDO0lBRUQ7OztNQUdFO0lBQ0ssWUFBTyxHQUFkLFVBQWUsQ0FBUyxFQUFFLENBQVMsRUFBRSxDQUFTLEVBQUUsQ0FBUztRQUN2RCxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ3hDLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUM7WUFBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDN0IsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxD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RSxDQUFDLE1BQU0sR0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLE1BQU0sR0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDO1FBQ3hMLElBQUksSUFBSSxHQUFHLENBQUMsRUFBRSxDQUFDLE1BQU0sR0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO1FBQzlDLEVBQUUsQ0FBQyxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUksSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDMUIsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFFLDBDQUEwQztRQUM1RCxDQUFDO1FBQUMsSUFBSSxDQUFDLENBQUM7WUFDSixNQUFNLENBQUMsSUFBSSxHQUFHLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQ2hDLENBQUM7SUFDSCxDQUFDO0lBQ0gsVUFBQztBQUFELENBdEJBLEFBc0JDLElBQUE7Ozs7QUN0QkQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsImV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhbVJlY29yZCB7XG4gIHF1YWxzOiBzdHJpbmc7XG4gIHNlcTogc3RyaW5nO1xuICBjaWdhcjogc3RyaW5nO1xuICByZWFkTmFtZTogc3RyaW5nO1xuICBuZXh0UG9zOiBudW1iZXI7XG4gIG5leHRTZWdtZW50OiBzdHJpbmc7XG4gIHNlcUxlbmd0aDogbnVtYmVyO1xuICBtcTogbnVtYmVyO1xuICBwb3M6IG51bWJlcjtcbiAgZmxhZzogbnVtYmVyO1xuICBzZWdtZW50OiBzdHJpbmc7XG59IiwiaW1wb3J0IFZvYiBmcm9tICcuL3ZvYic7Ly9tZXRob2RzOiByZWFkVm9iXG5pbXBvcnQgQkdaRiBmcm9tICcuL2JnemYnO1xuaW1wb3J0IHsgTnVtYmVyUmVhZGVyLCBVUkxGZXRjaGFibGUsIEJsb2JGZXRjaGFibGUgfSBmcm9tICcuL2Jpbic7XG5pbXBvcnQgQ2h1bmsgZnJvbSAnLi9jaHVuayc7XG5pbXBvcnQgQmFtUmVjb3JkIGZyb20gJy4vYmFtLXJlY29yZCc7XG5cbmV4cG9ydCBjbGFzcyBVdGlscyB7XG4gIHN0YXRpYyBudW1iZXJSZWFkZXIodHlwZTogc3RyaW5nLCBiYTogVWludDhBcnJheSAsIG9mZnNldDogbnVtYmVyKTogbnVtYmVye1xuICAgIGNvbnN0IGRpc3BhdGNoOiBhbnkgPSB7XG4gICAgICBpbnQ6IE51bWJlclJlYWRlci5yZWFkSW50LFxuICAgICAgaW50NjQ6IE51bWJlclJlYWRlci5yZWFkSW50NjQsXG4gICAgICBzaG9ydDogTnVtYmVyUmVhZGVyLnJlYWRTaG9ydCxcbiAgICAgIGJ5dGU6IE51bWJlclJlYWRlci5yZWFkQnl0ZSxcbiAgICAgIGludEJFOiBOdW1iZXJSZWFkZXIucmVhZEludEJFLFxuICAgICAgZmxvYXQ6IE51bWJlclJlYWRlci5yZWFkRmxvYXRcbiAgICB9O1xuXG4gICAgaWYoZGlzcGF0Y2hbdHlwZV0pe1xuICAgICAgcmV0dXJuIGRpc3BhdGNoW3R5cGVdKGJhLCBvZmZzZXQpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1R5cGUgbm90IHJlY29nbmlzZWQnKTtcbiAgICB9XG4gIH1cblxuICBzdGF0aWMgdXJsRmV0Y2hhYmxlRmFjdG9yeSh1cmw6IHN0cmluZywgc3RhcnQ6IG51bWJlciwgZW5kOiBudW1iZXIsIG9wdHM6IGFueSk6IFVSTEZldGNoYWJsZSB7XG4gICAgcmV0dXJuIG5ldyBVUkxGZXRjaGFibGUodXJsLCBzdGFydCwgZW5kLCBvcHRzKTtcbiAgfVxuXG4gIHN0YXRpYyBibG9iRmV0Y2hhYmxlRmFjdG9yeShibG9iOiBCbG9iKTogQmxvYkZldGNoYWJsZSB7XG4gICAgcmV0dXJuIG5ldyBCbG9iRmV0Y2hhYmxlKGJsb2IpO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBCYW1GaWxlIHtcbiAgaW5kZXhUb0Nocjogc3RyaW5nW107XG4gIGNoclRvSW5kZXg6IHsgW2tleTogc3RyaW5nXTogbnVtYmVyIH07XG4gIGluZGljZXM6IFVpbnQ4QXJyYXlbXTtcbiAgaW5kZXhDaHVua3M/OiBhbnk7XG4gIGJhaTogYW55O1xuICBkYXRhOiBhbnk7XG4gIHN0YXRpYyByZWFkb25seSBCQU1fTUFHSUMgPSAweDE0ZDQxNDI7XG4gIHN0YXRpYyByZWFkb25seSBCQUlfTUFHSUMgPSAweDE0OTQxNDI7XG4gIHN0YXRpYyByZWFkb25seSBCYW1GbGFnczoge1trZXk6IHN0cmluZ106IG51bWJlcn0gPSB7XG4gICAgTVVMVElQTEVfU0VHTUVOVFM6ICAgICAgIDB4MSxcbiAgICBBTExfU0VHTUVOVFNfQUxJR046ICAgICAgMHgyLFxuICAgIFNFR01FTlRfVU5NQVBQRUQ6ICAgICAgICAweDQsXG4gICAgTkVYVF9TRUdNRU5UX1VOTUFQUEVEOiAgIDB4OCxcbiAgICBSRVZFUlNFX0NPTVBMRU1FTlQ6ICAgICAgMHgxMCxcbiAgICBORVhUX1JFVkVSU0VfQ09NUExFTUVOVDogMHgyMCxcbiAgICBGSVJTVF9TRUdNRU5UOiAgICAgICAgICAgMHg0MCxcbiAgICBMQVNUX1NFR01FTlQ6ICAgICAgICAgICAgMHg4MCxcbiAgICBTRUNPTkRBUllfQUxJR05NRU5UOiAgICAgMHgxMDAsXG4gICAgUUNfRkFJTDogICAgICAgICAgICAgICAgIDB4MjAwLFxuICAgIERVUExJQ0FURTogICAgICAgICAgICAgICAweDQwMCxcbiAgICBTVVBQTEVNRU5UQVJZOiAgICAgICAgICAgMHg4MDBcbiAgfTtcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgU0VRUkVUX0RFQ09ERVIgPSBbJz0nLCAnQScsICdDJywgJ3gnLCAnRycsICd4JywgJ3gnLCAneCcsICdUJywgJ3gnLCAneCcsICd4JywgJ3gnLCAneCcsICd4JywgJ04nXTtcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgQ0lHQVJfREVDT0RFUiA9IFsnTScsICdJJywgJ0QnLCAnTicsICdTJywgJ0gnLCAnUCcsICc9JywgJ1gnLCAnPycsICc/JywgJz8nLCAnPycsICc/JywgJz8nLCAnPyddO1xuXG4gIHN0YXRpYyBmYWN0b3J5KGRhdGE6IGFueSwgYmFpOiBhbnksIGNhbGxiYWNrOiBhbnksIGF0dGVtcHRlZD86IGFueSwgaW5kZXhDaHVua3M/OiBhbnkpOiBCYW1GaWxlIHtcbiAgICBjb25zdCBiYW0gPSBuZXcgQmFtRmlsZSgpO1xuICAgIGJhbS5kYXRhID0gZGF0YTtcbiAgICBiYW0uYmFpID0gYmFpO1xuICAgIGJhbS5pbmRleENodW5rcyA9IGluZGV4Q2h1bmtzfHx1bmRlZmluZWQ7XG5cbiAgICBsZXQgbWluQmxvY2tJbmRleCA9IGJhbS5pbmRleENodW5rcyA/IGJhbS5pbmRleENodW5rcy5taW5CbG9ja0luZGV4IDogMTAwMDAwMDAwMDtcblxuICAgIC8vIEZpbGxzIG91dCBiYW0uY2hyVG9JbmRleCBhbmQgYmFtLmluZGV4VG9DaHIgYmFzZWQgb24gdGhlIGZpcnN0IGZldyBieXRlcyBvZiB0aGUgQkFNLlxuICAgIGNvbnN0IHBhcnNlQmFtSGVhZGVyID0gKHI6IEFycmF5QnVmZmVyKSA9PiB7XG4gICAgICBpZiAoIXIpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG51bGwsIFwiQ291bGRuJ3QgYWNjZXNzIEJBTVwiKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgdW5jID0gQkdaRi51bnppcChyLCByLmJ5dGVMZW5ndGgpO1xuICAgICAgY29uc3QgdW5jYmEgPSBuZXcgVWludDhBcnJheSh1bmMpO1xuXG4gICAgICBjb25zdCBtYWdpYyA9IE51bWJlclJlYWRlci5yZWFkSW50KHVuY2JhLCAwKTtcbiAgICAgIGlmIChtYWdpYyAhPSBCYW1GaWxlLkJBTV9NQUdJQykge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2sobnVsbCwgXCJOb3QgYSBCQU0gZmlsZSwgbWFnaWM9MHhcIiArIG1hZ2ljLnRvU3RyaW5nKDE2KSk7XG4gICAgICB9XG4gICAgICBsZXQgaGVhZExlbiA9IE51bWJlclJlYWRlci5yZWFkSW50KHVuY2JhLCA0KTtcbiAgICAgIGxldCBoZWFkZXIgPSAnJztcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZExlbjsgKytpKSB7XG4gICAgICAgIGhlYWRlciArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKHVuY2JhW2kgKyA4XSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5SZWYgPSBOdW1iZXJSZWFkZXIucmVhZEludCh1bmNiYSwgaGVhZExlbiArIDgpO1xuICAgICAgbGV0IHAgPSBoZWFkTGVuICsgMTI7XG5cbiAgICAgIGJhbS5jaHJUb0luZGV4ID0ge307XG4gICAgICBiYW0uaW5kZXhUb0NociA9IFtdO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuUmVmOyArK2kpIHtcbiAgICAgICAgY29uc3QgbE5hbWUgPSBOdW1iZXJSZWFkZXIucmVhZEludCh1bmNiYSwgcCk7XG4gICAgICAgIGxldCBuYW1lID0gJyc7XG4gICAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgbE5hbWUgLSAxOyArK2opIHtcbiAgICAgICAgICBuYW1lICs9IFN0cmluZy5mcm9tQ2hhckNvZGUodW5jYmFbcCArIDQgKyBqXSk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGxSZWYgPSBOdW1iZXJSZWFkZXIucmVhZEludCh1bmNiYSwgcCArIGxOYW1lICsgNCk7XG4gICAgICAgIGJhbS5jaHJUb0luZGV4W25hbWVdID0gaTtcbiAgICAgICAgaWYgKG5hbWUuaW5kZXhPZignY2hyJykgPT0gMCkge1xuICAgICAgICAgIGJhbS5jaHJUb0luZGV4W25hbWUuc3Vic3RyaW5nKDMpXSA9IGk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYmFtLmNoclRvSW5kZXhbJ2NocicgKyBuYW1lXSA9IGk7XG4gICAgICAgIH1cbiAgICAgICAgYmFtLmluZGV4VG9DaHIucHVzaChuYW1lKTtcblxuICAgICAgICBwID0gcCArIDggKyBsTmFtZTtcbiAgICAgIH1cblxuICAgICAgaWYgKGJhbS5pbmRpY2VzKSB7XG4gICAgICAgIHJldHVybiBjYWxsYmFjayhiYW0pO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBjb25zdCBwYXJzZUJhaSA9IChoZWFkZXI6IGFueSkgPT4ge1xuICAgICAgaWYgKCFoZWFkZXIpIHtcbiAgICAgICAgcmV0dXJuIFwiQ291bGRuJ3QgYWNjZXNzIEJBSVwiO1xuICAgICAgfVxuICAgICAgY29uc3QgdW5jYmEgPSBuZXcgVWludDhBcnJheShoZWFkZXIpO1xuICAgICAgY29uc3QgYmFpTWFnaWMgPSBOdW1iZXJSZWFkZXIucmVhZEludCh1bmNiYSwgMCk7XG4gICAgICBpZiAoYmFpTWFnaWMgIT0gQmFtRmlsZS5CQUlfTUFHSUMpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG51bGwsICdOb3QgYSBCQUkgZmlsZSwgbWFnaWM9MHgnICsgYmFpTWFnaWMudG9TdHJpbmcoMTYpKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG5yZWYgPSBOdW1iZXJSZWFkZXIucmVhZEludCh1bmNiYSwgNCk7XG4gICAgICBiYW0uaW5kaWNlcyA9IFtdO1xuICAgICAgbGV0IHAgPSA4O1xuICAgICAgZm9yIChsZXQgcmVmID0gMDsgcmVmIDwgbnJlZjsgKytyZWYpIHtcbiAgICAgICAgY29uc3QgYmxvY2tTdGFydCA9IHA7XG4gICAgICAgIGNvbnN0IG8gPSBCYW1GaWxlLmdldEJhaVJlZkxlbmd0aCh1bmNiYSwgYmxvY2tTdGFydCk7XG4gICAgICAgIHAgKz0gby5sZW5ndGg7XG4gICAgICAgIG1pbkJsb2NrSW5kZXggPSBNYXRoLm1pbihvLm1pbkJsb2NrSW5kZXgsIG1pbkJsb2NrSW5kZXgpO1xuICAgICAgICB2YXIgbmJpbiA9IG8ubmJpbjtcbiAgICAgICAgaWYgKG5iaW4gPiAwKSB7XG4gICAgICAgICAgYmFtLmluZGljZXNbcmVmXSA9IG5ldyBVaW50OEFycmF5KGhlYWRlciwgYmxvY2tTdGFydCwgcCAtIGJsb2NrU3RhcnQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9O1xuXG4gICAgaWYgKCFiYW0uaW5kZXhDaHVua3MpIHtcbiAgICAgIGJhbS5iYWkuZmV0Y2goZnVuY3Rpb24gKGhlYWRlcjogYW55KSB7ICAgLy8gRG8gd2UgcmVhbGx5IG5lZWQgdG8gZmV0Y2ggdGhlIHdob2xlIHRoaW5nPyA6LShcbiAgICAgICAgdmFyIHJlc3VsdCA9IHBhcnNlQmFpKGhlYWRlcik7XG4gICAgICAgIGlmIChyZXN1bHQgIT09IHRydWUpIHtcbiAgICAgICAgICBpZiAoYmFtLmJhaS51cmwgJiYgdHlwZW9mIChhdHRlbXB0ZWQpID09PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgICAgICAvLyBBbHJlYWR5IGF0dGVtcHRlZCB4LmJhbS5iYWkgbm90IHRoZXJlIHNvIG5vdyB0cnlpbmcgeC5iYWlcbiAgICAgICAgICAgIGJhbS5iYWkudXJsID0gYmFtLmRhdGEudXJsLnJlcGxhY2UobmV3IFJlZ0V4cCgnLmJhbSQnKSwgJy5iYWknKTtcblxuICAgICAgICAgICAgLy8gVHJ1ZSBsZXRzIHVzIGtub3cgd2UgYXJlIG1ha2luZyBhIHNlY29uZCBhdHRlbXB0XG4gICAgICAgICAgICByZXR1cm4gQmFtRmlsZS5mYWN0b3J5KGRhdGEsIGJhbS5iYWksIGNhbGxiYWNrLCB0cnVlLCBpbmRleENodW5rcyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gV2UndmUgYXR0ZW1wdGVkIHguYmFtLmJhaSAmIHguYmFpIGFuZCBub3RoaW5nIHdvcmtlZFxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgcmVzdWx0KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYmFtLmRhdGEuc2xpY2UoMCwgbWluQmxvY2tJbmRleCkuZmV0Y2gocGFyc2VCYW1IZWFkZXIsIHsgdGltZW91dDogNTAwMCB9KTtcbiAgICAgICAgfVxuICAgICAgfSwgeyB0aW1lb3V0OiA1MDAwIH0pOyAgIC8vIFRpbWVvdXQgb24gZmlyc3QgcmVxdWVzdCB0byBjYXRjaCBDaHJvbWUgbWl4ZWQtY29udGVudCBlcnJvci5cbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGNodW5rcyA9IGJhbS5pbmRleENodW5rcy5jaHVua3M7XG4gICAgICBiYW0uaW5kaWNlcyA9IFtdXG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNodW5rcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBiYW0uaW5kaWNlc1tpXSA9IG51bGw7ICAvLyBUbyBiZSBmaWxsZWQgb3V0IGxhemlseSBhcyBuZWVkZWRcbiAgICAgIH1cbiAgICAgIGJhbS5kYXRhLnNsaWNlKDAsIG1pbkJsb2NrSW5kZXgpLmZldGNoKHBhcnNlQmFtSGVhZGVyKTtcbiAgICB9XG4gICAgcmV0dXJuIGJhbTtcbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIGdldEJhaVJlZkxlbmd0aCh1bmNiYTogVWludDhBcnJheSwgb2Zmc2V0OiBudW1iZXIpIHtcbiAgICBsZXQgcCA9IG9mZnNldDtcbiAgICBsZXQgbmJpbiA9IE51bWJlclJlYWRlci5yZWFkSW50KHVuY2JhLCBwKTtcbiAgICBwICs9IDQ7XG4gICAgZm9yIChsZXQgYiA9IDA7IGIgPCBuYmluOyArK2IpIHtcbiAgICAgIGNvbnN0IGJpbiA9IE51bWJlclJlYWRlci5yZWFkSW50KHVuY2JhLCBwKTsvLyBub3QgdXNlZD9cbiAgICAgIGNvbnN0IG5jaG5rID0gTnVtYmVyUmVhZGVyLnJlYWRJbnQodW5jYmEsIHAgKyA0KTtcbiAgICAgIHAgKz0gOCArIChuY2huayAqIDE2KTtcbiAgICB9XG4gICAgY29uc3QgbmludHYgPSBOdW1iZXJSZWFkZXIucmVhZEludCh1bmNiYSwgcCk7IHAgKz0gNDtcblxuICAgIGxldCBtaW5CbG9ja0luZGV4ID0gMTAwMDAwMDAwMDtcbiAgICBsZXQgcSA9IHA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuaW50djsgKytpKSB7XG4gICAgICBjb25zdCB2ID0gVm9iLmZhY3RvcnkodW5jYmEsIHEpO1xuICAgICAgcSArPSA4O1xuICAgICAgaWYgKHYpIHtcbiAgICAgICAgdmFyIGJpID0gdi5ibG9jaztcbiAgICAgICAgaWYgKHYub2Zmc2V0ID4gMClcbiAgICAgICAgICBiaSArPSA2NTUzNjtcblxuICAgICAgICBpZiAoYmkgPCBtaW5CbG9ja0luZGV4KVxuICAgICAgICAgIG1pbkJsb2NrSW5kZXggPSBiaTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIHAgKz0gKG5pbnR2ICogOCk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgbWluQmxvY2tJbmRleDogbWluQmxvY2tJbmRleCxcbiAgICAgIG5iaW46IG5iaW4sXG4gICAgICBsZW5ndGg6IHAgLSBvZmZzZXRcbiAgICB9O1xuICB9XG5cbiAgLy9cbiAgLy8gQmlubmluZyAodHJhbnNsaXRlcmF0ZWQgZnJvbSBTQU0xLjMgc3BlYylcbiAgLy9cblxuICAvKiBjYWxjdWxhdGUgYmluIGdpdmVuIGFuIGFsaWdubWVudCBjb3ZlcmluZyBbYmVnLGVuZCkgKHplcm8tYmFzZWQsIGhhbGYtY2xvc2UtaGFsZi1vcGVuKSAqL1xuICBwcml2YXRlIHN0YXRpYyByZWcyYmluKGJlZzogbnVtYmVyLCBlbmQ6IG51bWJlcik6IG51bWJlciB7XG4gICAgLS1lbmQ7XG4gICAgaWYgKGJlZyA+PiAxNCA9PSBlbmQgPj4gMTQpIHJldHVybiAoKDEgPDwgMTUpIC0gMSkgLyA3ICsgKGJlZyA+PiAxNCk7XG4gICAgaWYgKGJlZyA+PiAxNyA9PSBlbmQgPj4gMTcpIHJldHVybiAoKDEgPDwgMTIpIC0gMSkgLyA3ICsgKGJlZyA+PiAxNyk7XG4gICAgaWYgKGJlZyA+PiAyMCA9PSBlbmQgPj4gMjApIHJldHVybiAoKDEgPDwgOSkgLSAxKSAvIDcgKyAoYmVnID4+IDIwKTtcbiAgICBpZiAoYmVnID4+IDIzID09IGVuZCA+PiAyMykgcmV0dXJuICgoMSA8PCA2KSAtIDEpIC8gNyArIChiZWcgPj4gMjMpO1xuICAgIGlmIChiZWcgPj4gMjYgPT0gZW5kID4+IDI2KSByZXR1cm4gKCgxIDw8IDMpIC0gMSkgLyA3ICsgKGJlZyA+PiAyNik7XG4gICAgcmV0dXJuIDA7XG4gIH1cblxuICAvKiBjYWxjdWxhdGUgdGhlIGxpc3Qgb2YgYmlucyB0aGF0IG1heSBvdmVybGFwIHdpdGggcmVnaW9uIFtiZWcsZW5kKSAoemVyby1iYXNlZCkgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgcmVnMmJpbnMoYmVnOiBudW1iZXIsIGVuZDogbnVtYmVyKTogbnVtYmVyW10ge1xuICAgIGxldCBrOiBudW1iZXI7XG4gICAgY29uc3QgbGlzdDogbnVtYmVyW10gPSBbXTtcbiAgICAtLWVuZDtcbiAgICBsaXN0LnB1c2goMCk7XG4gICAgZm9yIChrID0gMSArIChiZWcgPj4gMjYpOyBrIDw9IDEgKyAoZW5kID4+IDI2KTsgKytrKSBsaXN0LnB1c2goayk7XG4gICAgZm9yIChrID0gOSArIChiZWcgPj4gMjMpOyBrIDw9IDkgKyAoZW5kID4+IDIzKTsgKytrKSBsaXN0LnB1c2goayk7XG4gICAgZm9yIChrID0gNzMgKyAoYmVnID4+IDIwKTsgayA8PSA3MyArIChlbmQgPj4gMjApOyArK2spIGxpc3QucHVzaChrKTtcbiAgICBmb3IgKGsgPSA1ODUgKyAoYmVnID4+IDE3KTsgayA8PSA1ODUgKyAoZW5kID4+IDE3KTsgKytrKSBsaXN0LnB1c2goayk7XG4gICAgZm9yIChrID0gNDY4MSArIChiZWcgPj4gMTQpOyBrIDw9IDQ2ODEgKyAoZW5kID4+IDE0KTsgKytrKSBsaXN0LnB1c2goayk7XG4gICAgcmV0dXJuIGxpc3Q7XG4gIH1cblxuICBjb25zdHJ1Y3RvcigpIHsgfVxuXG4gIGJsb2Nrc0ZvclJhbmdlKHJlZklkOiBudW1iZXIsIG1pbjogbnVtYmVyLCBtYXg6IG51bWJlcik6IENodW5rW10ge1xuICAgIGNvbnN0IGluZGV4OiBVaW50OEFycmF5ID0gdGhpcy5pbmRpY2VzW3JlZklkXTtcbiAgICBpZiAoIWluZGV4KSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgY29uc3QgaW50Qmluc0wgPSBCYW1GaWxlLnJlZzJiaW5zKG1pbiwgbWF4KTtcbiAgICBjb25zdCBpbnRCaW5zOiBib29sZWFuW10gPSBbXTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGludEJpbnNMLmxlbmd0aDsgKytpKSB7XG4gICAgICBpbnRCaW5zW2ludEJpbnNMW2ldXSA9IHRydWU7XG4gICAgfVxuICAgIGNvbnN0IGxlYWZDaHVua3M6IENodW5rW10gPSBbXTtcbiAgICBsZXQgb3RoZXJDaHVua3M6IENodW5rW10gPSBbXTtcblxuICAgIGNvbnN0IG5iaW4gPSBOdW1iZXJSZWFkZXIucmVhZEludChpbmRleCwgMCk7XG4gICAgbGV0IHAgPSA0O1xuICAgIGZvciAobGV0IGIgPSAwOyBiIDwgbmJpbjsgKytiKSB7XG4gICAgICBjb25zdCBiaW4gPSBOdW1iZXJSZWFkZXIucmVhZEludChpbmRleCwgcCk7XG4gICAgICBjb25zdCBuY2huayA9IE51bWJlclJlYWRlci5yZWFkSW50KGluZGV4LCBwICsgNCk7XG4gICAgICAvLyBkbG9nKCdiaW49JyArIGJpbiArICc7IG5jaG5rPScgKyBuY2huayk7XG4gICAgICBwICs9IDg7XG4gICAgICBpZiAoaW50Qmluc1tiaW5dKSB7XG4gICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgbmNobms7ICsrYykge1xuICAgICAgICAgIGNvbnN0IGNzID0gVm9iLmZhY3RvcnkoaW5kZXgsIHApO1xuICAgICAgICAgIGNvbnN0IGNlID0gVm9iLmZhY3RvcnkoaW5kZXgsIHAgKyA4KTtcbiAgICAgICAgICAoYmluIDwgNDY4MSA/IG90aGVyQ2h1bmtzIDogbGVhZkNodW5rcykucHVzaChuZXcgQ2h1bmsoY3MsIGNlKSk7XG4gICAgICAgICAgcCArPSAxNjtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcCArPSAobmNobmsgKiAxNik7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG5pbnR2ID0gTnVtYmVyUmVhZGVyLnJlYWRJbnQoaW5kZXgsIHApO1xuICAgIGxldCBsb3dlc3Q6IFZvYiA9IG51bGw7XG4gICAgY29uc3QgbWluTGluID0gTWF0aC5taW4obWluID4+IDE0LCBuaW50diAtIDEpLCBtYXhMaW4gPSBNYXRoLm1pbihtYXggPj4gMTQsIG5pbnR2IC0gMSk7XG4gICAgZm9yIChsZXQgaSA9IG1pbkxpbjsgaSA8PSBtYXhMaW47ICsraSkge1xuICAgICAgY29uc3QgbGIgPSBWb2IuZmFjdG9yeShpbmRleCwgcCArIDQgKyAoaSAqIDgpKTtcbiAgICAgIGlmICghbGIpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoIWxvd2VzdCB8fCBsYi5ibG9jayA8IGxvd2VzdC5ibG9jayB8fCBsYi5vZmZzZXQgPCBsb3dlc3Qub2Zmc2V0KSB7XG4gICAgICAgIGxvd2VzdCA9IGxiO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHBydW5lZE90aGVyQ2h1bmtzID0gW107XG4gICAgaWYgKGxvd2VzdCAhPSBudWxsKSB7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG90aGVyQ2h1bmtzLmxlbmd0aDsgKytpKSB7XG4gICAgICAgIGNvbnN0IGNobmsgPSBvdGhlckNodW5rc1tpXTtcbiAgICAgICAgaWYgKGNobmsubWF4di5ibG9jayA+PSBsb3dlc3QuYmxvY2sgJiYgY2huay5tYXh2Lm9mZnNldCA+PSBsb3dlc3Qub2Zmc2V0KSB7XG4gICAgICAgICAgcHJ1bmVkT3RoZXJDaHVua3MucHVzaChjaG5rKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBvdGhlckNodW5rcyA9IHBydW5lZE90aGVyQ2h1bmtzO1xuICAgIGNvbnN0IGludENodW5rcyA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgb3RoZXJDaHVua3MubGVuZ3RoOyArK2kpIHtcbiAgICAgIGludENodW5rcy5wdXNoKG90aGVyQ2h1bmtzW2ldKTtcbiAgICB9XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsZWFmQ2h1bmtzLmxlbmd0aDsgKytpKSB7XG4gICAgICBpbnRDaHVua3MucHVzaChsZWFmQ2h1bmtzW2ldKTtcbiAgICB9XG5cbiAgICBpbnRDaHVua3Muc29ydCgoYzA6IENodW5rLCBjMTogQ2h1bmspID0+IHtcbiAgICAgIGNvbnN0IGRpZiA9IGMwLm1pbnYuYmxvY2sgLSBjMS5taW52LmJsb2NrO1xuICAgICAgaWYgKGRpZiAhPSAwKSB7XG4gICAgICAgIHJldHVybiBkaWY7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gYzAubWludi5vZmZzZXQgLSBjMS5taW52Lm9mZnNldDtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IG1lcmdlZENodW5rczogQ2h1bmtbXSA9IFtdO1xuICAgIGlmIChpbnRDaHVua3MubGVuZ3RoID4gMCkge1xuICAgICAgbGV0IGN1ciA9IGludENodW5rc1swXTtcbiAgICAgIGZvciAobGV0IGkgPSAxOyBpIDwgaW50Q2h1bmtzLmxlbmd0aDsgKytpKSB7XG4gICAgICAgIGNvbnN0IG5jID0gaW50Q2h1bmtzW2ldO1xuICAgICAgICBpZiAobmMubWludi5ibG9jayA9PSBjdXIubWF4di5ibG9jayAvKiAmJiBuYy5taW52Lm9mZnNldCA9PSBjdXIubWF4di5vZmZzZXQgKi8pIHsgLy8gbm8gcG9pbnQgc3BsaXR0aW5nIG1pZC1ibG9ja1xuICAgICAgICAgIGN1ciA9IG5ldyBDaHVuayhjdXIubWludiwgbmMubWF4dik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbWVyZ2VkQ2h1bmtzLnB1c2goY3VyKTtcbiAgICAgICAgICBjdXIgPSBuYztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgbWVyZ2VkQ2h1bmtzLnB1c2goY3VyKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbWVyZ2VkQ2h1bmtzO1xuICB9XG5cbiAgZmV0Y2goY2hyOiBzdHJpbmcsIG1pbjogbnVtYmVyLCBtYXg6IG51bWJlciwgY2FsbGJhY2s6IGFueSwgb3B0czogYW55KTogYW55IHtcbiAgICBjb25zdCB0aGlzQiA9IHRoaXM7XG4gICAgb3B0cyA9IG9wdHMgfHwge307XG5cbiAgICBjb25zdCBjaHJJZDogbnVtYmVyID0gdGhpcy5jaHJUb0luZGV4W2Nocl07XG4gICAgbGV0IGNodW5rczogQ2h1bmtbXTtcbiAgICBpZiAoY2hySWQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgY2h1bmtzID0gW107XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZldGNoIHRoaXMgcG9ydGlvbiBvZiB0aGUgQkFJIGlmIGl0IGhhc24ndCBiZWVuIGxvYWRlZCB5ZXQuXG4gICAgICBpZiAodGhpcy5pbmRpY2VzW2NocklkXSA9PT0gbnVsbCAmJiB0aGlzLmluZGV4Q2h1bmtzLmNodW5rc1tjaHJJZF0pIHtcbiAgICAgICAgY29uc3Qgc3RhcnRfc3RvcCA9IHRoaXMuaW5kZXhDaHVua3MuY2h1bmtzW2NocklkXTtcbiAgICAgICAgcmV0dXJuIHRoaXMuYmFpLnNsaWNlKHN0YXJ0X3N0b3BbMF0sIHN0YXJ0X3N0b3BbMV0pXG4gICAgICAgICAgLmZldGNoKFxuICAgICAgICAgIChkYXRhOiBhbnkpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGJ1ZmZlciA9IG5ldyBVaW50OEFycmF5KGRhdGEpO1xuICAgICAgICAgICAgdGhpcy5pbmRpY2VzW2NocklkXSA9IGJ1ZmZlcjtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmZldGNoKGNociwgbWluLCBtYXgsIGNhbGxiYWNrLCBvcHRzKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgY2h1bmtzID0gdGhpcy5ibG9ja3NGb3JSYW5nZShjaHJJZCwgbWluLCBtYXgpO1xuICAgICAgaWYgKCFjaHVua3MpIHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgJ0Vycm9yIGluIGluZGV4IGZldGNoJyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVjb3JkczogYW55W10gPSBbXTtcbiAgICBsZXQgaW5kZXggPSAwO1xuICAgIGxldCBkYXRhOiBBcnJheUJ1ZmZlcjtcblxuICAgIGZ1bmN0aW9uIHRyYW1wKCk6IGFueSB7XG4gICAgICBpZiAoaW5kZXggPj0gY2h1bmtzLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2socmVjb3Jkcyk7XG4gICAgICB9IGVsc2UgaWYgKCFkYXRhKSB7XG4gICAgICAgIHZhciBjID0gY2h1bmtzW2luZGV4XTtcbiAgICAgICAgdmFyIGZldGNoTWluID0gYy5taW52LmJsb2NrO1xuICAgICAgICB2YXIgZmV0Y2hNYXggPSBjLm1heHYuYmxvY2sgKyAoMSA8PCAxNik7IC8vICpzaWdoKlxuICAgICAgICAvLyBjb25zb2xlLmxvZygnZmV0Y2hpbmcgJyArIGZldGNoTWluICsgJzonICsgZmV0Y2hNYXgpO1xuICAgICAgICB0aGlzQi5kYXRhLnNsaWNlKGZldGNoTWluLCBmZXRjaE1heCAtIGZldGNoTWluKS5mZXRjaChmdW5jdGlvbiAocjogQXJyYXlCdWZmZXIpIHtcbiAgICAgICAgICBkYXRhID0gQkdaRi51bnppcChyLCBjLm1heHYuYmxvY2sgLSBjLm1pbnYuYmxvY2sgKyAxKTtcbiAgICAgICAgICByZXR1cm4gdHJhbXAoKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgYmEgPSBuZXcgVWludDhBcnJheShkYXRhKTtcbiAgICAgICAgdmFyIGZpbmlzaGVkID0gdGhpc0IucmVhZEJhbVJlY29yZHMoYmEsIGNodW5rc1tpbmRleF0ubWludi5vZmZzZXQsIHJlY29yZHMsIG1pbiwgbWF4LCBjaHJJZCwgb3B0cyk7XG4gICAgICAgIGRhdGEgPSBudWxsO1xuICAgICAgICArK2luZGV4O1xuICAgICAgICBpZiAoZmluaXNoZWQpXG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKHJlY29yZHMpO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgcmV0dXJuIHRyYW1wKCk7XG4gICAgICB9XG4gICAgfVxuICAgIHRyYW1wKCk7XG4gIH1cblxuICByZWFkQmFtUmVjb3JkcyhiYTogVWludDhBcnJheSwgb2Zmc2V0OiBudW1iZXIsIHNpbms6IEJhbVJlY29yZFtdLCBtaW46IG51bWJlciwgbWF4OiBudW1iZXIsIGNocklkOiBudW1iZXIsIG9wdHM6IGFueSk6IGJvb2xlYW4ge1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBibG9ja1NpemUgPSBOdW1iZXJSZWFkZXIucmVhZEludChiYSwgb2Zmc2V0KTtcbiAgICAgIGNvbnN0IGJsb2NrRW5kID0gb2Zmc2V0ICsgYmxvY2tTaXplICsgNDtcbiAgICAgIGlmIChibG9ja0VuZCA+PSBiYS5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCByZWNvcmQ6IEJhbVJlY29yZCA9IG5ldyBCYW1SZWNvcmQoKTtcblxuICAgICAgY29uc3QgcmVmSUQgPSBOdW1iZXJSZWFkZXIucmVhZEludChiYSwgb2Zmc2V0ICsgNCk7XG4gICAgICBjb25zdCBwb3MgPSBOdW1iZXJSZWFkZXIucmVhZEludChiYSwgb2Zmc2V0ICsgOCk7XG5cbiAgICAgIGNvbnN0IGJtbiA9IE51bWJlclJlYWRlci5yZWFkSW50KGJhLCBvZmZzZXQgKyAxMik7XG4gICAgICBjb25zdCBiaW4gPSAoYm1uICYgMHhmZmZmMDAwMCkgPj4gMTY7XG4gICAgICBjb25zdCBtcSA9IChibW4gJiAweGZmMDApID4+IDg7XG4gICAgICBjb25zdCBubCA9IGJtbiAmIDB4ZmY7XG5cbiAgICAgIGNvbnN0IGZsYWdfbmMgPSBOdW1iZXJSZWFkZXIucmVhZEludChiYSwgb2Zmc2V0ICsgMTYpO1xuICAgICAgY29uc3QgZmxhZyA9IChmbGFnX25jICYgMHhmZmZmMDAwMCkgPj4gMTY7XG4gICAgICBjb25zdCBuYyA9IGZsYWdfbmMgJiAweGZmZmY7XG5cbiAgICAgIGNvbnN0IGxzZXEgPSBOdW1iZXJSZWFkZXIucmVhZEludChiYSwgb2Zmc2V0ICsgMjApO1xuXG4gICAgICBjb25zdCBuZXh0UmVmID0gTnVtYmVyUmVhZGVyLnJlYWRJbnQoYmEsIG9mZnNldCArIDI0KTtcbiAgICAgIGNvbnN0IG5leHRQb3MgPSBOdW1iZXJSZWFkZXIucmVhZEludChiYSwgb2Zmc2V0ICsgMjgpO1xuXG4gICAgICBjb25zdCB0bGVuID0gTnVtYmVyUmVhZGVyLnJlYWRJbnQoYmEsIG9mZnNldCArIDMyKTtcblxuICAgICAgcmVjb3JkLnNlZ21lbnQgPSB0aGlzLmluZGV4VG9DaHJbcmVmSURdO1xuICAgICAgcmVjb3JkLmZsYWcgPSBmbGFnO1xuICAgICAgcmVjb3JkLnBvcyA9IHBvcztcbiAgICAgIHJlY29yZC5tcSA9IG1xO1xuICAgICAgaWYgKG9wdHMubGlnaHQpXG4gICAgICAgIHJlY29yZC5zZXFMZW5ndGggPSBsc2VxO1xuXG4gICAgICBpZiAoIW9wdHMubGlnaHQpIHtcbiAgICAgICAgaWYgKG5leHRSZWYgPj0gMCkge1xuICAgICAgICAgIHJlY29yZC5uZXh0U2VnbWVudCA9IHRoaXMuaW5kZXhUb0NocltuZXh0UmVmXTtcbiAgICAgICAgICByZWNvcmQubmV4dFBvcyA9IG5leHRQb3M7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgcmVhZE5hbWUgPSAnJztcbiAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBubCAtIDE7ICsraikge1xuICAgICAgICAgIHJlYWROYW1lICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYmFbb2Zmc2V0ICsgMzYgKyBqXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmVjb3JkLnJlYWROYW1lID0gcmVhZE5hbWU7XG5cbiAgICAgICAgbGV0IHAgPSBvZmZzZXQgKyAzNiArIG5sO1xuXG4gICAgICAgIGxldCBjaWdhciA9ICcnO1xuICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IG5jOyArK2MpIHtcbiAgICAgICAgICBjb25zdCBjaWdvcCA9IE51bWJlclJlYWRlci5yZWFkSW50KGJhLCBwKTtcbiAgICAgICAgICBjaWdhciA9IGNpZ2FyICsgKGNpZ29wID4+IDQpICsgQmFtRmlsZS5DSUdBUl9ERUNPREVSW2NpZ29wICYgMHhmXTtcbiAgICAgICAgICBwICs9IDQ7XG4gICAgICAgIH1cbiAgICAgICAgcmVjb3JkLmNpZ2FyID0gY2lnYXI7XG5cbiAgICAgICAgbGV0IHNlcSA9ICcnO1xuICAgICAgICBjb25zdCBzZXFCeXRlcyA9IChsc2VxICsgMSkgPj4gMTtcbiAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBzZXFCeXRlczsgKytqKSB7XG4gICAgICAgICAgY29uc3Qgc2IgPSBiYVtwICsgal07XG4gICAgICAgICAgc2VxICs9IEJhbUZpbGUuU0VRUkVUX0RFQ09ERVJbKHNiICYgMHhmMCkgPj4gNF07XG4gICAgICAgICAgaWYgKHNlcS5sZW5ndGggPCBsc2VxKVxuICAgICAgICAgICAgc2VxICs9IEJhbUZpbGUuU0VRUkVUX0RFQ09ERVJbKHNiICYgMHgwZildO1xuICAgICAgICB9XG4gICAgICAgIHAgKz0gc2VxQnl0ZXM7XG4gICAgICAgIHJlY29yZC5zZXEgPSBzZXE7XG5cbiAgICAgICAgbGV0IHFzZXEgPSAnJztcbiAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBsc2VxOyArK2opIHtcbiAgICAgICAgICBxc2VxICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYmFbcCArIGpdICsgMzMpO1xuICAgICAgICB9XG4gICAgICAgIHAgKz0gbHNlcTtcbiAgICAgICAgcmVjb3JkLnF1YWxzID0gcXNlcTtcblxuICAgICAgICB3aGlsZSAocCA8IGJsb2NrRW5kKSB7XG4gICAgICAgICAgY29uc3QgdGFnID0gU3RyaW5nLmZyb21DaGFyQ29kZShiYVtwXSwgYmFbcCArIDFdKTtcbiAgICAgICAgICBjb25zdCB0eXBlID0gU3RyaW5nLmZyb21DaGFyQ29kZShiYVtwICsgMl0pO1xuICAgICAgICAgIGxldCB2YWx1ZTtcblxuICAgICAgICAgIGlmICh0eXBlID09ICdBJykge1xuICAgICAgICAgICAgdmFsdWUgPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJhW3AgKyAzXSk7XG4gICAgICAgICAgICBwICs9IDQ7XG4gICAgICAgICAgfSBlbHNlIGlmICh0eXBlID09ICdpJyB8fCB0eXBlID09ICdJJykge1xuICAgICAgICAgICAgdmFsdWUgPSBOdW1iZXJSZWFkZXIucmVhZEludChiYSwgcCArIDMpO1xuICAgICAgICAgICAgcCArPSA3O1xuICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSAnYycgfHwgdHlwZSA9PSAnQycpIHtcbiAgICAgICAgICAgIHZhbHVlID0gYmFbcCArIDNdO1xuICAgICAgICAgICAgcCArPSA0O1xuICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSAncycgfHwgdHlwZSA9PSAnUycpIHtcbiAgICAgICAgICAgIHZhbHVlID0gTnVtYmVyUmVhZGVyLnJlYWRTaG9ydChiYSwgcCArIDMpO1xuICAgICAgICAgICAgcCArPSA1O1xuICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSAnZicpIHtcbiAgICAgICAgICAgIHZhbHVlID0gTnVtYmVyUmVhZGVyLnJlYWRGbG9hdChiYSwgcCArIDMpO1xuICAgICAgICAgICAgcCArPSA3O1xuICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSAnWicgfHwgdHlwZSA9PSAnSCcpIHtcbiAgICAgICAgICAgIHAgKz0gMztcbiAgICAgICAgICAgIHZhbHVlID0gJyc7XG4gICAgICAgICAgICBmb3IgKDsgOykge1xuICAgICAgICAgICAgICBjb25zdCBjYyA9IGJhW3ArK107XG4gICAgICAgICAgICAgIGlmIChjYyA9PSAwKSB7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdmFsdWUgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShjYyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT0gJ0InKSB7XG4gICAgICAgICAgICBjb25zdCBhdHlwZSA9IFN0cmluZy5mcm9tQ2hhckNvZGUoYmFbcCArIDNdKTtcbiAgICAgICAgICAgIGNvbnN0IGFsZW4gPSBOdW1iZXJSZWFkZXIucmVhZEludChiYSwgcCArIDQpO1xuICAgICAgICAgICAgbGV0IGVsZW47XG4gICAgICAgICAgICBsZXQgcmVhZGVyO1xuICAgICAgICAgICAgaWYgKGF0eXBlID09ICdpJyB8fCBhdHlwZSA9PSAnSScgfHwgYXR5cGUgPT0gJ2YnKSB7XG4gICAgICAgICAgICAgIGVsZW4gPSA0O1xuICAgICAgICAgICAgICBpZiAoYXR5cGUgPT0gJ2YnKVxuICAgICAgICAgICAgICAgIHJlYWRlciA9IE51bWJlclJlYWRlci5yZWFkRmxvYXQ7XG4gICAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICByZWFkZXIgPSBOdW1iZXJSZWFkZXIucmVhZEludDtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoYXR5cGUgPT0gJ3MnIHx8IGF0eXBlID09ICdTJykge1xuICAgICAgICAgICAgICBlbGVuID0gMjtcbiAgICAgICAgICAgICAgcmVhZGVyID0gTnVtYmVyUmVhZGVyLnJlYWRTaG9ydDtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoYXR5cGUgPT0gJ2MnIHx8IGF0eXBlID09ICdDJykge1xuICAgICAgICAgICAgICBlbGVuID0gMTtcbiAgICAgICAgICAgICAgcmVhZGVyID0gTnVtYmVyUmVhZGVyLnJlYWRCeXRlO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhyb3cgJ1Vua25vd24gYXJyYXkgdHlwZSAnICsgYXR5cGU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHAgKz0gODtcbiAgICAgICAgICAgIHZhbHVlID0gW107XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGFsZW47ICsraSkge1xuICAgICAgICAgICAgICB2YWx1ZS5wdXNoKHJlYWRlcihiYSwgcCkpO1xuICAgICAgICAgICAgICBwICs9IGVsZW47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93ICdVbmtub3duIHR5cGUgJyArIHR5cGU7XG4gICAgICAgICAgfVxuICAgICAgICAgICg8YW55PnJlY29yZClbdGFnXSA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICghbWluIHx8IHJlY29yZC5wb3MgPD0gbWF4ICYmIHJlY29yZC5wb3MgKyBsc2VxID49IG1pbikge1xuICAgICAgICBpZiAoY2hySWQgPT09IHVuZGVmaW5lZCB8fCByZWZJRCA9PSBjaHJJZCkge1xuICAgICAgICAgIHNpbmsucHVzaChyZWNvcmQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAocmVjb3JkLnBvcyA+IG1heCkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIG9mZnNldCA9IGJsb2NrRW5kO1xuICAgIH1cblxuICAgIC8vIEV4aXRzIHZpYSB0b3Agb2YgbG9vcC5cbiAgfTtcblxuXG5cbn0iLCJpbXBvcnQgKiBhcyBqc3psaWIgZnJvbSAnanN6bGliJztcblxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCR1pGIHtcbiAgc3RhdGljIHVuemlwKGRhdGE6IEFycmF5QnVmZmVyLCBsaW06IG51bWJlcik6IEFycmF5QnVmZmVyIHtcbiAgICBsaW0gPSBNYXRoLm1pbihsaW0gfHwgMSwgZGF0YS5ieXRlTGVuZ3RoIC0gNTApO1xuICAgIHZhciBvQmxvY2tMaXN0ID0gW107XG4gICAgdmFyIHB0ciA9IFswXTtcbiAgICB2YXIgdG90YWxTaXplID0gMDtcblxuICAgIHdoaWxlIChwdHJbMF0gPCBsaW0pIHtcbiAgICAgICAgdmFyIGJhID0gbmV3IFVpbnQ4QXJyYXkoZGF0YSwgcHRyWzBdLCAxMik7IC8vIEZJWE1FIGlzIHRoaXMgZW5vdWdoIGZvciBhbGwgY3JlZGlibGUgQkdaRiBibG9jayBoZWFkZXJzP1xuICAgICAgICB2YXIgeGxlbiA9IChiYVsxMV0gPDwgOCkgfCAoYmFbMTBdKTtcbiAgICAgICAgLy8gZGxvZygneGxlblsnICsgKHB0clswXSkgKyddPScgKyB4bGVuKTtcbiAgICAgICAgdmFyIHVuYyA9IGpzemxpYi5pbmZsYXRlQnVmZmVyKGRhdGEsIDEyICsgeGxlbiArIHB0clswXSwgTWF0aC5taW4oNjU1MzYsIGRhdGEuYnl0ZUxlbmd0aCAtIDEyIC0geGxlbiAtIHB0clswXSksIHB0cik7XG4gICAgICAgIHB0clswXSArPSA4O1xuICAgICAgICB0b3RhbFNpemUgKz0gdW5jLmJ5dGVMZW5ndGg7XG4gICAgICAgIG9CbG9ja0xpc3QucHVzaCh1bmMpO1xuICAgIH1cblxuICAgIGlmIChvQmxvY2tMaXN0Lmxlbmd0aCA9PSAxKSB7XG4gICAgICAgIHJldHVybiBvQmxvY2tMaXN0WzBdO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBvdXQgPSBuZXcgVWludDhBcnJheSh0b3RhbFNpemUpO1xuICAgICAgICB2YXIgY3Vyc29yID0gMDtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBvQmxvY2tMaXN0Lmxlbmd0aDsgKytpKSB7XG4gICAgICAgICAgICB2YXIgYiA9IG5ldyBVaW50OEFycmF5KG9CbG9ja0xpc3RbaV0pO1xuICAgICAgICAgICAganN6bGliLmFycmF5Q29weShiLCAwLCBvdXQsIGN1cnNvciwgYi5sZW5ndGgpO1xuICAgICAgICAgICAgY3Vyc29yICs9IGIubGVuZ3RoO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBvdXQuYnVmZmVyO1xuICAgIH1cbiAgfVxufSIsImltcG9ydCBVdGlscyBmcm9tICcuL3V0aWxzJztcbmltcG9ydCBTSEExIGZyb20gJy4vc2hhMSc7XG5cbmNsYXNzIEZpbGVSZWFkZXJTeW5jIHtcbiAgLyoqXG4gICAqIEBzZWUgaHR0cDovL3d3dy53My5vcmcvVFIvRmlsZUFQSS8jRmlsZVJlYWRlclN5bmNTeW5jXG4gICAqIEBjb25zdHJ1Y3RvclxuICAgKi9cbiAgY29uc3RydWN0b3IoKSB7IH1cblxuICAvKipcbiAgKiBAc2VlIGh0dHA6Ly93d3cudzMub3JnL1RSL0ZpbGVBUEkvI2Rmbi1yZWFkQXNBcnJheUJ1ZmZlclN5bmNcbiAgKiBAcGFyYW0geyFCbG9ifSBibG9iXG4gICovXG4gIHJlYWRBc0FycmF5QnVmZmVyKGJsb2I6IEJsb2IpIHsgfTtcblxuICAvKipcbiAgICogQHNlZSBodHRwOi8vd3d3LnczLm9yZy9UUi9GaWxlQVBJLyNkZm4tcmVhZEFzQmluYXJ5U3RyaW5nU3luY1xuICAgKiBAcGFyYW0geyFCbG9ifSBibG9iXG4gICAqL1xuICByZWFkQXNCaW5hcnlTdHJpbmcoYmxvYjogQmxvYikgeyB9O1xuXG4gIC8qKlxuICAgKiBAc2VlIGh0dHA6Ly93d3cudzMub3JnL1RSL0ZpbGVBUEkvI2Rmbi1yZWFkQXNUZXh0U3luY1xuICAgKiBAcGFyYW0geyFCbG9ifSBibG9iXG4gICAqIEBwYXJhbSB7c3RyaW5nPX0gZW5jb2RpbmdcbiAgICovXG4gIHJlYWRBc1RleHQoYmxvYjogQmxvYiwgZW5jb2Rpbmc6IHN0cmluZykgeyB9O1xuXG4gIC8qKlxuICAgKiBAc2VlIGh0dHA6Ly93d3cudzMub3JnL1RSL0ZpbGVBUEkvI2Rmbi1yZWFkQXNEYXRhVVJMU3luY1xuICAgKiBAcGFyYW0geyFCbG9ifSBibG9iXG4gICAqL1xuICByZWFkQXNEYXRhVVJMKGJsb2I6IEJsb2IpIHsgfTtcblxufVxuXG5hYnN0cmFjdCBjbGFzcyBGZXRjaGFibGUge1xuICBhYnN0cmFjdCBzbGljZShzOiBudW1iZXIsIGw6IG51bWJlcik6IEZldGNoYWJsZTtcbiAgYWJzdHJhY3Qgc2FsdGVkKCk6IEZldGNoYWJsZTtcbiAgYWJzdHJhY3QgZmV0Y2goY2FsbGJhY2s6IGFueSwgb3B0PzogYW55KTogdm9pZDtcblxuICBzdGF0aWMgYnN0cmluZ1RvQnVmZmVyKHJlc3VsdDogc3RyaW5nKTogQXJyYXlCdWZmZXIge1xuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICB2YXIgYmEgPSBuZXcgVWludDhBcnJheShyZXN1bHQubGVuZ3RoKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGJhLmxlbmd0aDsgKytpKSB7XG4gICAgICBiYVtpXSA9IHJlc3VsdC5jaGFyQ29kZUF0KGkpO1xuICAgIH1cbiAgICByZXR1cm4gYmEuYnVmZmVyO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBCbG9iRmV0Y2hhYmxlIGV4dGVuZHMgRmV0Y2hhYmxle1xuICBibG9iOiBCbG9iO1xuXG4gIGNvbnN0cnVjdG9yKGJsb2I6IEJsb2IpIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMuYmxvYiA9IGJsb2I7XG4gIH1cblxuICBzbGljZShzdGFydDogbnVtYmVyLCBsZW5ndGg6IG51bWJlcik6IEJsb2JGZXRjaGFibGUge1xuICAgIGxldCBiO1xuXG4gICAgaWYgKHRoaXMuYmxvYi5zbGljZSkge1xuICAgICAgaWYgKGxlbmd0aCkge1xuICAgICAgICBiID0gdGhpcy5ibG9iLnNsaWNlKHN0YXJ0LCBzdGFydCArIGxlbmd0aCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBiID0gdGhpcy5ibG9iLnNsaWNlKHN0YXJ0KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGxlbmd0aCkge1xuICAgICAgICBiID0gKDxhbnk+dGhpcy5ibG9iKS53ZWJraXRTbGljZShzdGFydCwgc3RhcnQgKyBsZW5ndGgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYiA9ICg8YW55PnRoaXMuYmxvYikud2Via2l0U2xpY2Uoc3RhcnQpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbmV3IEJsb2JGZXRjaGFibGUoYik7XG4gIH1cblxuICBzYWx0ZWQoKTogQmxvYkZldGNoYWJsZSB7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBmZXRjaChjYWxsYmFjazogYW55KTogdm9pZCB7XG4gICAgaWYgKHR5cGVvZiAoRmlsZVJlYWRlcikgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAvLyBjb25zb2xlLmxvZygnZGVmaW5pbmcgYXN5bmMgQmxvYkZldGNoYWJsZS5mZXRjaCcpO1xuICAgICAgY29uc3QgcmVhZGVyID0gbmV3IEZpbGVSZWFkZXIoKTtcbiAgICAgIHJlYWRlci5vbmxvYWRlbmQgPSBmdW5jdGlvbiAoZXYpIHtcbiAgICAgICAgY2FsbGJhY2soQmxvYkZldGNoYWJsZS5ic3RyaW5nVG9CdWZmZXIocmVhZGVyLnJlc3VsdCkpO1xuICAgICAgfTtcbiAgICAgIHJlYWRlci5yZWFkQXNCaW5hcnlTdHJpbmcodGhpcy5ibG9iKTtcblxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBpZiAoY29uc29sZSAmJiBjb25zb2xlLmxvZylcbiAgICAgIC8vICAgIGNvbnNvbGUubG9nKCdkZWZpbmluZyBzeW5jIEJsb2JGZXRjaGFibGUuZmV0Y2gnKTtcbiAgICAgIGNvbnN0IHJlYWRlciA9IG5ldyBGaWxlUmVhZGVyU3luYygpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzID0gcmVhZGVyLnJlYWRBc0FycmF5QnVmZmVyKHRoaXMuYmxvYik7XG4gICAgICAgIGNhbGxiYWNrKHJlcyk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgVVJMRmV0Y2hhYmxlIGV4dGVuZHMgRmV0Y2hhYmxlIHtcbiAgb3B0czogYW55O1xuICBlbmQ6IG51bWJlcjtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgdXJsOiBzdHJpbmc7XG4gIHN0YXRpYyBzZWVkID0gMDtcbiAgc3RhdGljIGlzU2FmYXJpOiBib29sZWFuID0gbmF2aWdhdG9yLnVzZXJBZ2VudC5pbmRleE9mKCdTYWZhcmknKSA+PSAwICYmIG5hdmlnYXRvci51c2VyQWdlbnQuaW5kZXhPZignQ2hyb21lJykgPCAwO1xuXG4gIGNvbnN0cnVjdG9yKHVybDogc3RyaW5nLCBzdGFydD86IG51bWJlciwgZW5kPzogbnVtYmVyLCBvcHRzPzogYW55KSB7XG4gICAgc3VwZXIoKTtcbiAgICBpZiAoIW9wdHMpIHtcbiAgICAgIGlmICh0eXBlb2Ygc3RhcnQgPT09ICdvYmplY3QnKSB7XG4gICAgICAgIG9wdHMgPSBzdGFydDtcbiAgICAgICAgc3RhcnQgPSB1bmRlZmluZWQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvcHRzID0ge307XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMudXJsID0gdXJsO1xuICAgIHRoaXMuc3RhcnQgPSBzdGFydCB8fCAwO1xuICAgIGlmIChlbmQpIHtcbiAgICAgIHRoaXMuZW5kID0gZW5kO1xuICAgIH1cbiAgICB0aGlzLm9wdHMgPSBvcHRzO1xuICB9XG5cbiAgc2xpY2UoczogbnVtYmVyLCBsOiBudW1iZXIpOiBVUkxGZXRjaGFibGUge1xuICAgIGlmIChzIDwgMCkge1xuICAgICAgdGhyb3cgJ0JhZCBzbGljZSAnICsgcztcbiAgICB9XG5cbiAgICBsZXQgbnMgPSB0aGlzLnN0YXJ0LCBuZSA9IHRoaXMuZW5kO1xuICAgIGlmIChucyAmJiBzKSB7XG4gICAgICBucyA9IG5zICsgcztcbiAgICB9IGVsc2Uge1xuICAgICAgbnMgPSBzIHx8IG5zO1xuICAgIH1cbiAgICBpZiAobCAmJiBucykge1xuICAgICAgbmUgPSBucyArIGwgLSAxO1xuICAgIH0gZWxzZSB7XG4gICAgICBuZSA9IG5lIHx8IGwgLSAxO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IFVSTEZldGNoYWJsZSh0aGlzLnVybCwgbnMsIG5lLCB0aGlzLm9wdHMpO1xuICB9XG5cbiAgZmV0Y2hBc1RleHQoY2FsbGJhY2s6IGFueSk6IGFueSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlcSA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuICAgICAgbGV0IGxlbmd0aDtcbiAgICAgIGxldCB1cmwgPSB0aGlzLnVybDtcbiAgICAgIGlmICgoVVJMRmV0Y2hhYmxlLmlzU2FmYXJpIHx8IHRoaXMub3B0cy5zYWx0KSAmJiB1cmwuaW5kZXhPZignPycpIDwgMCkge1xuICAgICAgICBjb25zdCBzaGExID0gbmV3IFNIQTEoJycgKyBEYXRlLm5vdygpICsgJywnICsgKCsrVVJMRmV0Y2hhYmxlLnNlZWQpKTtcbiAgICAgICAgdXJsID0gdXJsICsgJz9zYWx0PScgKyBzaGExLmI2NF9zaGExO1xuICAgICAgfVxuICAgICAgcmVxLm9wZW4oJ0dFVCcsIHVybCwgdHJ1ZSk7XG5cbiAgICAgIGlmICh0aGlzLmVuZCkge1xuICAgICAgICBpZiAodGhpcy5lbmQgLSB0aGlzLnN0YXJ0ID4gMTAwMDAwMDAwKSB7XG4gICAgICAgICAgdGhyb3cgJ01vbnN0ZXIgZmV0Y2ghJztcbiAgICAgICAgfVxuICAgICAgICByZXEuc2V0UmVxdWVzdEhlYWRlcignUmFuZ2UnLCAnYnl0ZXM9JyArIHRoaXMuc3RhcnQgKyAnLScgKyB0aGlzLmVuZCk7XG4gICAgICAgIGxlbmd0aCA9IHRoaXMuZW5kIC0gdGhpcy5zdGFydCArIDE7XG4gICAgICB9XG5cbiAgICAgIHJlcS5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmIChyZXEucmVhZHlTdGF0ZSA9PSA0KSB7XG4gICAgICAgICAgaWYgKHJlcS5zdGF0dXMgPT0gMjAwIHx8IHJlcS5zdGF0dXMgPT0gMjA2KSB7XG4gICAgICAgICAgICByZXR1cm4gY2FsbGJhY2socmVxLnJlc3BvbnNlVGV4dCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBpZiAodGhpcy5vcHRzLmNyZWRlbnRpYWxzKSB7XG4gICAgICAgIHJlcS53aXRoQ3JlZGVudGlhbHMgPSB0cnVlO1xuICAgICAgfVxuICAgICAgcmVxLnNlbmQoJycpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhudWxsKTtcbiAgICB9XG4gIH1cblxuICBzYWx0ZWQoKTogVVJMRmV0Y2hhYmxlIHtcbiAgICBjb25zdCBvID0gVXRpbHMuc2hhbGxvd0NvcHkodGhpcy5vcHRzKTtcbiAgICBvLnNhbHQgPSB0cnVlO1xuICAgIHJldHVybiBuZXcgVVJMRmV0Y2hhYmxlKHRoaXMudXJsLCB0aGlzLnN0YXJ0LCB0aGlzLmVuZCwgbyk7XG4gIH1cblxuICBmZXRjaChjYWxsYmFjazogYW55LCBvcHRzOiBhbnkpOiBhbnkge1xuICAgIGNvbnN0IHRoaXNCID0gdGhpcztcblxuICAgIG9wdHMgPSBvcHRzIHx8IHt9O1xuICAgIGNvbnN0IGF0dGVtcHQgPSBvcHRzLmF0dGVtcHQgfHwgMTtcbiAgICBjb25zdCB0cnVuY2F0ZWRMZW5ndGggPSBvcHRzLnRydW5jYXRlZExlbmd0aDtcbiAgICBpZiAoYXR0ZW1wdCA+IDMpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhudWxsKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgbGV0IHRpbWVvdXQ6IG51bWJlcjtcbiAgICAgIGlmIChvcHRzLnRpbWVvdXQgJiYgIXRoaXMub3B0cy5jcmVkZW50aWFscykge1xuICAgICAgICB0aW1lb3V0ID0gc2V0VGltZW91dChcbiAgICAgICAgICBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygndGltaW5nIG91dCAnICsgdXJsKTtcbiAgICAgICAgICAgIHJlcS5hYm9ydCgpO1xuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG51bGwsICdUaW1lb3V0Jyk7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBvcHRzLnRpbWVvdXRcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVxID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG4gICAgICBsZXQgbGVuZ3RoOiBudW1iZXI7XG4gICAgICBsZXQgdXJsID0gdGhpcy51cmw7XG4gICAgICBpZiAoKFVSTEZldGNoYWJsZS5pc1NhZmFyaSB8fCB0aGlzLm9wdHMuc2FsdCkgJiYgdXJsLmluZGV4T2YoJz8nKSA8IDApIHtcbiAgICAgICAgY29uc3Qgc2hhMSA9IG5ldyBTSEExKCcnICsgRGF0ZS5ub3coKSArICcsJyArICgrK1VSTEZldGNoYWJsZS5zZWVkKSk7XG4gICAgICAgIHVybCA9IHVybCArICc/c2FsdD0nICsgc2hhMS5iNjRfc2hhMTtcbiAgICAgIH1cbiAgICAgIHJlcS5vcGVuKCdHRVQnLCB1cmwsIHRydWUpO1xuICAgICAgcmVxLm92ZXJyaWRlTWltZVR5cGUoJ3RleHQvcGxhaW47IGNoYXJzZXQ9eC11c2VyLWRlZmluZWQnKTtcbiAgICAgIGlmICh0aGlzLmVuZCkge1xuICAgICAgICBpZiAodGhpcy5lbmQgLSB0aGlzLnN0YXJ0ID4gMTAwMDAwMDAwKSB7XG4gICAgICAgICAgdGhyb3cgJ01vbnN0ZXIgZmV0Y2ghJztcbiAgICAgICAgfVxuICAgICAgICByZXEuc2V0UmVxdWVzdEhlYWRlcignUmFuZ2UnLCAnYnl0ZXM9JyArIHRoaXMuc3RhcnQgKyAnLScgKyB0aGlzLmVuZCk7XG4gICAgICAgIGxlbmd0aCA9IHRoaXMuZW5kIC0gdGhpcy5zdGFydCArIDE7XG4gICAgICB9XG4gICAgICByZXEucmVzcG9uc2VUeXBlID0gJ2FycmF5YnVmZmVyJztcbiAgICAgIHJlcS5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmIChyZXEucmVhZHlTdGF0ZSA9PSA0KSB7XG4gICAgICAgICAgaWYgKHRpbWVvdXQpXG4gICAgICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICAgICAgaWYgKHJlcS5zdGF0dXMgPT0gMjAwIHx8IHJlcS5zdGF0dXMgPT0gMjA2KSB7XG4gICAgICAgICAgICBpZiAocmVxLnJlc3BvbnNlKSB7XG4gICAgICAgICAgICAgIHZhciBibCA9IHJlcS5yZXNwb25zZS5ieXRlTGVuZ3RoO1xuICAgICAgICAgICAgICBpZiAobGVuZ3RoICYmIGxlbmd0aCAhPSBibCAmJiAoIXRydW5jYXRlZExlbmd0aCB8fCBibCAhPSB0cnVuY2F0ZWRMZW5ndGgpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNCLmZldGNoKGNhbGxiYWNrLCB7IGF0dGVtcHQ6IGF0dGVtcHQgKyAxLCB0cnVuY2F0ZWRMZW5ndGg6IGJsIH0pO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayhyZXEucmVzcG9uc2UpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2UgaWYgKCg8YW55PnJlcSkubW96UmVzcG9uc2VBcnJheUJ1ZmZlcikge1xuICAgICAgICAgICAgICByZXR1cm4gY2FsbGJhY2soKDxhbnk+cmVxKS5tb3pSZXNwb25zZUFycmF5QnVmZmVyKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHZhciByID0gcmVxLnJlc3BvbnNlVGV4dDtcbiAgICAgICAgICAgICAgaWYgKGxlbmd0aCAmJiBsZW5ndGggIT0gci5sZW5ndGggJiYgKCF0cnVuY2F0ZWRMZW5ndGggfHwgci5sZW5ndGggIT0gdHJ1bmNhdGVkTGVuZ3RoKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzQi5mZXRjaChjYWxsYmFjaywgeyBhdHRlbXB0OiBhdHRlbXB0ICsgMSwgdHJ1bmNhdGVkTGVuZ3RoOiByLmxlbmd0aCB9KTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY2FsbGJhY2soVVJMRmV0Y2hhYmxlLmJzdHJpbmdUb0J1ZmZlcihyZXEucmVzcG9uc2VUZXh0KSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXNCLmZldGNoKGNhbGxiYWNrLCB7IGF0dGVtcHQ6IGF0dGVtcHQgKyAxIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGlmICh0aGlzLm9wdHMuY3JlZGVudGlhbHMpIHtcbiAgICAgICAgcmVxLndpdGhDcmVkZW50aWFscyA9IHRydWU7XG4gICAgICB9XG4gICAgICByZXEuc2VuZCgnJyk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKG51bGwpO1xuICAgIH1cbiAgfVxuXG59XG5cbmV4cG9ydCBjbGFzcyBOdW1iZXJSZWFkZXIge1xuICBzdGF0aWMgcmVhZEludChiYTogVWludDhBcnJheSAsIG9mZnNldDogbnVtYmVyKTogbnVtYmVyIHtcbiAgICByZXR1cm4gKGJhW29mZnNldCArIDNdIDw8IDI0KSB8IChiYVtvZmZzZXQgKyAyXSA8PCAxNikgfCAoYmFbb2Zmc2V0ICsgMV0gPDwgOCkgfCAoYmFbb2Zmc2V0XSk7XG4gIH1cblxuICBzdGF0aWMgcmVhZEludDY0KGJhOiBVaW50OEFycmF5ICwgb2Zmc2V0OiBudW1iZXIpOiBudW1iZXIge1xuICAgIHJldHVybiAoYmFbb2Zmc2V0ICsgN10gPDwgMjQpIHwgKGJhW29mZnNldCArIDZdIDw8IDE2KSB8IChiYVtvZmZzZXQgKyA1XSA8PCA4KSB8IChiYVtvZmZzZXQgKyA0XSk7XG4gIH1cblxuICBzdGF0aWMgcmVhZFNob3J0KGJhOiBVaW50OEFycmF5ICwgb2Zmc2V0OiBudW1iZXIpOiBudW1iZXIge1xuICAgIHJldHVybiAoYmFbb2Zmc2V0ICsgMV0gPDwgOCkgfCAoYmFbb2Zmc2V0XSk7XG4gIH1cblxuICBzdGF0aWMgcmVhZEJ5dGUoYmE6IFVpbnQ4QXJyYXkgLCBvZmZzZXQ6IG51bWJlcik6IG51bWJlciB7XG4gICAgcmV0dXJuIGJhW29mZnNldF07XG4gIH1cblxuICBzdGF0aWMgcmVhZEludEJFKGJhOiBVaW50OEFycmF5ICwgb2Zmc2V0OiBudW1iZXIpOiBudW1iZXIge1xuICAgIHJldHVybiAoYmFbb2Zmc2V0XSA8PCAyNCkgfCAoYmFbb2Zmc2V0ICsgMV0gPDwgMTYpIHwgKGJhW29mZnNldCArIDJdIDw8IDgpIHwgKGJhW29mZnNldCArIDNdKTtcbiAgfVxuXG4gIHN0YXRpYyByZWFkRmxvYXQoYnVmOiBVaW50OEFycmF5ICwgb2Zmc2V0OiBudW1iZXIpe1xuICAgIGNvbnN0IGNvbnZlcnRCdWZmZXIgPSBuZXcgQXJyYXlCdWZmZXIoOCk7XG4gICAgY29uc3QgZGF0YXZpZXcgPSBuZXcgRGF0YVZpZXcoY29udmVydEJ1ZmZlcik7XG4gICAgZm9yKGxldCBpID0gMDsgaSA8IDQ7IGkrKyl7XG4gICAgICBkYXRhdmlldy5zZXRVaW50OChpLCBidWZbb2Zmc2V0ICsgaV0pOyAgXG4gICAgfVxuICAgIHJldHVybiBkYXRhdmlldy5nZXRGbG9hdDMyKDApO1xuICB9XG59IiwiaW1wb3J0IFZvYiBmcm9tIFwiLi92b2JcIjtcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQ2h1bmsge1xuICBtaW52OiBWb2I7XG4gIG1heHY6IFZvYjtcblxuICBjb25zdHJ1Y3RvcihtaW52OiBWb2IsIG1heHY6IFZvYil7XG4gICAgdGhpcy5tYXh2ID0gbWF4djtcbiAgICB0aGlzLm1pbnYgPSBtaW52OyAgXG4gIH1cblxufSIsIi8qXHJcbiAqIEEgSmF2YVNjcmlwdCBpbXBsZW1lbnRhdGlvbiBvZiB0aGUgU2VjdXJlIEhhc2ggQWxnb3JpdGhtLCBTSEEtMSwgYXMgZGVmaW5lZFxyXG4gKiBpbiBGSVBTIDE4MC0xXHJcbiAqIFZlcnNpb24gMy4wIENvcHlyaWdodCBLcmlzdGlhbiBHcmF5IDIwMTcuXHJcbiAqIE90aGVyIGNvbnRyaWJ1dG9yczogUGF1bCBKb2huc3RvbiwgR3JlZyBIb2x0LCBBbmRyZXcgS2VwZXJ0LCBZZG5hciwgTG9zdGluZXRcclxuICogRGlzdHJpYnV0ZWQgdW5kZXIgdGhlIEJTRCBMaWNlbnNlXHJcbiAqIFNlZSBodHRwOi8vcGFqaG9tZS5vcmcudWsvY3J5cHQvbWQ1IGZvciBkZXRhaWxzLlxyXG4gKi9cclxuXHJcbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNIQTEge1xyXG4gIC8qXHJcbiAgKiBDb25maWd1cmFibGUgdmFyaWFibGVzLiBZb3UgbWF5IG5lZWQgdG8gdHdlYWsgdGhlc2UgdG8gYmUgY29tcGF0aWJsZSB3aXRoXHJcbiAgKiB0aGUgc2VydmVyLXNpZGUsIGJ1dCB0aGUgZGVmYXVsdHMgd29yayBpbiBtb3N0IGNhc2VzLlxyXG4gICovXHJcbiAgc3RhdGljIGI2NHBhZCA9ICcnOyAvKiBiYXNlLTY0IHBhZCBjaGFyYWN0ZXIuIFwiPVwiIGZvciBzdHJpY3QgUkZDIGNvbXBsaWFuY2UgICAqL1xyXG4gIHByaXZhdGUgX3F1ZXJ5OiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSBfYjY0X3NoYTE6IHN0cmluZztcclxuXHJcbiAgY29uc3RydWN0b3IoaW5wdXQ6IHN0cmluZykge1xyXG4gICAgdGhpcy5fcXVlcnkgPSBpbnB1dDtcclxuICAgIHRoaXMuX2I2NF9zaGExID0gU0hBMS5yc3RyMmI2NChcclxuICAgICAgU0hBMS5yc3RyX3NoYTEoXHJcbiAgICAgICAgU0hBMS5zdHIycnN0cl91dGY4KHRoaXMuX3F1ZXJ5KVxyXG4gICAgICApXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgZ2V0IGI2NF9zaGExKCk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gdGhpcy5fYjY0X3NoYTE7XHJcbiAgfVxyXG5cclxuICAvKlxyXG4gICogQ29udmVydCBhIHJhdyBzdHJpbmcgdG8gYSBiYXNlLTY0IHN0cmluZ1xyXG4gICovXHJcbiAgc3RhdGljIHJzdHIyYjY0KGlucHV0OiBzdHJpbmcpIHtcclxuICAgIC8vIHRyeSB7IGI2NHBhZCB9IGNhdGNoKGUpIHsgYjY0cGFkPScnOyB9XHJcbiAgICB2YXIgdGFiID0gXCJBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvXCI7XHJcbiAgICB2YXIgb3V0cHV0ID0gXCJcIjtcclxuICAgIHZhciBsZW4gPSBpbnB1dC5sZW5ndGg7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSArPSAzKSB7XHJcbiAgICAgIHZhciB0cmlwbGV0ID0gKGlucHV0LmNoYXJDb2RlQXQoaSkgPDwgMTYpXHJcbiAgICAgICAgfCAoaSArIDEgPCBsZW4gPyBpbnB1dC5jaGFyQ29kZUF0KGkgKyAxKSA8PCA4IDogMClcclxuICAgICAgICB8IChpICsgMiA8IGxlbiA/IGlucHV0LmNoYXJDb2RlQXQoaSArIDIpIDogMCk7XHJcbiAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgNDsgaisrKSB7XHJcbiAgICAgICAgaWYgKGkgKiA4ICsgaiAqIDYgPiBpbnB1dC5sZW5ndGggKiA4KSBvdXRwdXQgKz0gU0hBMS5iNjRwYWQ7XHJcbiAgICAgICAgZWxzZSBvdXRwdXQgKz0gdGFiLmNoYXJBdCgodHJpcGxldCA+Pj4gNiAqICgzIC0gaikpICYgMHgzRik7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBvdXRwdXQ7XHJcbiAgfVxyXG5cclxuICAvKlxyXG4gICogRW5jb2RlIGEgc3RyaW5nIGFzIHV0Zi04LlxyXG4gICogRm9yIGVmZmljaWVuY3ksIHRoaXMgYXNzdW1lcyB0aGUgaW5wdXQgaXMgdmFsaWQgdXRmLTE2LlxyXG4gICovXHJcbiAgc3RhdGljIHN0cjJyc3RyX3V0ZjgoaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBsZXQgb3V0cHV0ID0gJyc7XHJcbiAgICBsZXQgaSA9IC0xO1xyXG4gICAgbGV0IHgsIHk7XHJcblxyXG4gICAgd2hpbGUgKCsraSA8IGlucHV0Lmxlbmd0aCkge1xyXG4gICAgICAvKiBEZWNvZGUgdXRmLTE2IHN1cnJvZ2F0ZSBwYWlycyAqL1xyXG4gICAgICB4ID0gaW5wdXQuY2hhckNvZGVBdChpKTtcclxuICAgICAgeSA9IGkgKyAxIDwgaW5wdXQubGVuZ3RoID8gaW5wdXQuY2hhckNvZGVBdChpICsgMSkgOiAwO1xyXG4gICAgICBpZiAoMHhEODAwIDw9IHggJiYgeCA8PSAweERCRkYgJiYgMHhEQzAwIDw9IHkgJiYgeSA8PSAweERGRkYpIHtcclxuICAgICAgICB4ID0gMHgxMDAwMCArICgoeCAmIDB4MDNGRikgPDwgMTApICsgKHkgJiAweDAzRkYpO1xyXG4gICAgICAgIGkrKztcclxuICAgICAgfVxyXG5cclxuICAgICAgLyogRW5jb2RlIG91dHB1dCBhcyB1dGYtOCAqL1xyXG4gICAgICBpZiAoeCA8PSAweDdGKVxyXG4gICAgICAgIG91dHB1dCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKHgpO1xyXG4gICAgICBlbHNlIGlmICh4IDw9IDB4N0ZGKVxyXG4gICAgICAgIG91dHB1dCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4QzAgfCAoKHggPj4+IDYpICYgMHgxRiksXHJcbiAgICAgICAgICAweDgwIHwgKHggJiAweDNGKSk7XHJcbiAgICAgIGVsc2UgaWYgKHggPD0gMHhGRkZGKVxyXG4gICAgICAgIG91dHB1dCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4RTAgfCAoKHggPj4+IDEyKSAmIDB4MEYpLFxyXG4gICAgICAgICAgMHg4MCB8ICgoeCA+Pj4gNikgJiAweDNGKSxcclxuICAgICAgICAgIDB4ODAgfCAoeCAmIDB4M0YpKTtcclxuICAgICAgZWxzZSBpZiAoeCA8PSAweDFGRkZGRilcclxuICAgICAgICBvdXRwdXQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZSgweEYwIHwgKCh4ID4+PiAxOCkgJiAweDA3KSxcclxuICAgICAgICAgIDB4ODAgfCAoKHggPj4+IDEyKSAmIDB4M0YpLFxyXG4gICAgICAgICAgMHg4MCB8ICgoeCA+Pj4gNikgJiAweDNGKSxcclxuICAgICAgICAgIDB4ODAgfCAoeCAmIDB4M0YpKTtcclxuICAgIH1cclxuICAgIHJldHVybiBvdXRwdXQ7XHJcbiAgfVxyXG5cclxuICAvKlxyXG4gICogQ2FsY3VsYXRlIHRoZSBTSEExIG9mIGEgcmF3IHN0cmluZ1xyXG4gICovXHJcbiAgc3RhdGljIHJzdHJfc2hhMShyc3RyOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIFNIQTEuYmluYjJyc3RyKFxyXG4gICAgICBTSEExLmJpbmJfc2hhMShcclxuICAgICAgICBTSEExLnJzdHIyYmluYihyc3RyKSxcclxuICAgICAgICByc3RyLmxlbmd0aCAqIDhcclxuICAgICAgKVxyXG4gICAgKTtcclxuICB9XHJcbiAgXHJcbiAgLypcclxuICAqIENvbnZlcnQgYSByYXcgc3RyaW5nIHRvIGFuIGFycmF5IG9mIGJpZy1lbmRpYW4gd29yZHNcclxuICAqIENoYXJhY3RlcnMgPjI1NSBoYXZlIHRoZWlyIGhpZ2gtYnl0ZSBzaWxlbnRseSBpZ25vcmVkLlxyXG4gICovXHJcbiAgc3RhdGljIHJzdHIyYmluYihyc3RyOiBzdHJpbmcpOiBudW1iZXJbXSB7XHJcbiAgICBsZXQgYmluYiA9IG5ldyBBcnJheShyc3RyLmxlbmd0aCA+PiAyKTtcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYmluYi5sZW5ndGg7IGkrKykge1xyXG4gICAgICBiaW5iW2ldID0gMDtcclxuICAgIH1cclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcnN0ci5sZW5ndGggKiA4OyBpICs9IDgpIHtcclxuICAgICAgYmluYltpID4+IDVdIHw9IChyc3RyLmNoYXJDb2RlQXQoaSAvIDgpICYgMHhGRikgPDwgKDI0IC0gaSAlIDMyKTtcclxuICAgIH1cclxuICAgIHJldHVybiBiaW5iO1xyXG4gIH1cclxuICBcclxuICAvKlxyXG4gICogQ2FsY3VsYXRlIHRoZSBTSEEtMSBvZiBhbiBhcnJheSBvZiBiaWctZW5kaWFuIHdvcmRzLCBhbmQgYSBiaXQgbGVuZ3RoXHJcbiAgKi9cclxuICBzdGF0aWMgYmluYl9zaGExKGJpbmI6IG51bWJlcltdLCBsZW46IG51bWJlcik6IG51bWJlcltdIHtcclxuICAgIC8qIGFwcGVuZCBwYWRkaW5nICovXHJcbiAgICBiaW5iW2xlbiA+PiA1XSB8PSAweDgwIDw8ICgyNCAtIGxlbiAlIDMyKTtcclxuICAgIGJpbmJbKChsZW4gKyA2NCA+PiA5KSA8PCA0KSArIDE1XSA9IGxlbjtcclxuXHJcbiAgICBsZXQgdyA9IG5ldyBBcnJheSg4MCk7XHJcbiAgICBsZXQgYSA9IDE3MzI1ODQxOTM7XHJcbiAgICBsZXQgYiA9IC0yNzE3MzM4Nzk7XHJcbiAgICBsZXQgYyA9IC0xNzMyNTg0MTk0O1xyXG4gICAgbGV0IGQgPSAyNzE3MzM4Nzg7XHJcbiAgICBsZXQgZSA9IC0xMDA5NTg5Nzc2O1xyXG5cclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYmluYi5sZW5ndGg7IGkgKz0gMTYpIHtcclxuICAgICAgY29uc3Qgb2xkYSA9IGE7XHJcbiAgICAgIGNvbnN0IG9sZGIgPSBiO1xyXG4gICAgICBjb25zdCBvbGRjID0gYztcclxuICAgICAgY29uc3Qgb2xkZCA9IGQ7XHJcbiAgICAgIGNvbnN0IG9sZGUgPSBlO1xyXG5cclxuICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCA4MDsgaisrKSB7XHJcbiAgICAgICAgaWYgKGogPCAxNil7XHJcbiAgICAgICAgICB3W2pdID0gYmluYltpICsgal07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgd1tqXSA9IFNIQTEuYml0X3JvbCh3W2ogLSAzXSBeIHdbaiAtIDhdIF4gd1tqIC0gMTRdIF4gd1tqIC0gMTZdLCAxKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgdCA9IFNIQTEuc2FmZV9hZGQoXHJcbiAgICAgICAgICBTSEExLnNhZmVfYWRkKFNIQTEuYml0X3JvbChhLCA1KSxcclxuICAgICAgICAgIFNIQTEuc2hhMV9mdChqLCBiLCBjLCBkKSksXHJcbiAgICAgICAgICBTSEExLnNhZmVfYWRkKFxyXG4gICAgICAgICAgICBTSEExLnNhZmVfYWRkKGUsIHdbal0pLFxyXG4gICAgICAgICAgICBTSEExLnNoYTFfa3QoailcclxuICAgICAgICAgIClcclxuICAgICAgICApO1xyXG4gICAgICAgIGUgPSBkO1xyXG4gICAgICAgIGQgPSBjO1xyXG4gICAgICAgIGMgPSBTSEExLmJpdF9yb2woYiwgMzApO1xyXG4gICAgICAgIGIgPSBhO1xyXG4gICAgICAgIGEgPSB0O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBhID0gU0hBMS5zYWZlX2FkZChhLCBvbGRhKTtcclxuICAgICAgYiA9IFNIQTEuc2FmZV9hZGQoYiwgb2xkYik7XHJcbiAgICAgIGMgPSBTSEExLnNhZmVfYWRkKGMsIG9sZGMpO1xyXG4gICAgICBkID0gU0hBMS5zYWZlX2FkZChkLCBvbGRkKTtcclxuICAgICAgZSA9IFNIQTEuc2FmZV9hZGQoZSwgb2xkZSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbmV3IEFycmF5KGEsIGIsIGMsIGQsIGUpO1xyXG4gIH1cclxuXHJcbiAgLypcclxuICAqIERldGVybWluZSB0aGUgYXBwcm9wcmlhdGUgYWRkaXRpdmUgY29uc3RhbnQgZm9yIHRoZSBjdXJyZW50IGl0ZXJhdGlvblxyXG4gICovXHJcbiAgc3RhdGljIHNoYTFfa3QodDogbnVtYmVyKTogbnVtYmVyIHtcclxuICAgIHJldHVybiAodCA8IDIwKSA/IDE1MTg1MDAyNDkgOiAodCA8IDQwKSA/IDE4NTk3NzUzOTMgOlxyXG4gICAgICAodCA8IDYwKSA/IC0xODk0MDA3NTg4IDogLTg5OTQ5NzUxNDtcclxuICB9XHJcblxyXG4gIC8qXHJcbiAgKiBQZXJmb3JtIHRoZSBhcHByb3ByaWF0ZSB0cmlwbGV0IGNvbWJpbmF0aW9uIGZ1bmN0aW9uIGZvciB0aGUgY3VycmVudFxyXG4gICogaXRlcmF0aW9uXHJcbiAgKi9cclxuICBzdGF0aWMgc2hhMV9mdCh0OiBudW1iZXIsIGI6IG51bWJlciwgYzogbnVtYmVyLCBkOiBudW1iZXIpOiBudW1iZXIge1xyXG4gICAgaWYgKHQgPCAyMCkgcmV0dXJuIChiICYgYykgfCAoKH5iKSAmIGQpO1xyXG4gICAgaWYgKHQgPCA0MCkgcmV0dXJuIGIgXiBjIF4gZDtcclxuICAgIGlmICh0IDwgNjApIHJldHVybiAoYiAmIGMpIHwgKGIgJiBkKSB8IChjICYgZCk7XHJcbiAgICByZXR1cm4gYiBeIGMgXiBkO1xyXG4gIH1cclxuXHJcbiAgLypcclxuICAqIEFkZCBpbnRlZ2Vycywgd3JhcHBpbmcgYXQgMl4zMi4gVGhpcyB1c2VzIDE2LWJpdCBvcGVyYXRpb25zIGludGVybmFsbHlcclxuICAqIHRvIHdvcmsgYXJvdW5kIGJ1Z3MgaW4gc29tZSBKUyBpbnRlcnByZXRlcnMuXHJcbiAgKi9cclxuICBzdGF0aWMgc2FmZV9hZGQoeDogbnVtYmVyLCB5OiBudW1iZXIpOiBudW1iZXIge1xyXG4gICAgdmFyIGxzdyA9ICh4ICYgMHhGRkZGKSArICh5ICYgMHhGRkZGKTtcclxuICAgIHZhciBtc3cgPSAoeCA+PiAxNikgKyAoeSA+PiAxNikgKyAobHN3ID4+IDE2KTtcclxuICAgIHJldHVybiAobXN3IDw8IDE2KSB8IChsc3cgJiAweEZGRkYpO1xyXG4gIH1cclxuXHJcbiAgLypcclxuICAqIEJpdHdpc2Ugcm90YXRlIGEgMzItYml0IG51bWJlciB0byB0aGUgbGVmdC5cclxuICAqL1xyXG4gIHN0YXRpYyBiaXRfcm9sKG51bTogbnVtYmVyLCBjbnQ6IG51bWJlcik6IG51bWJlciB7XHJcbiAgICByZXR1cm4gKG51bSA8PCBjbnQpIHwgKG51bSA+Pj4gKDMyIC0gY250KSk7XHJcbiAgfVxyXG5cclxuICAvKlxyXG4gICogQ29udmVydCBhbiBhcnJheSBvZiBiaWctZW5kaWFuIHdvcmRzIHRvIGEgc3RyaW5nXHJcbiAgKi9cclxuICBzdGF0aWMgYmluYjJyc3RyKGlucHV0OiBudW1iZXJbXSk6IHN0cmluZyB7XHJcbiAgICB2YXIgb3V0cHV0ID0gXCJcIjtcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaW5wdXQubGVuZ3RoICogMzI7IGkgKz0gOClcclxuICAgICAgb3V0cHV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoKGlucHV0W2kgPj4gNV0gPj4+ICgyNCAtIGkgJSAzMikpICYgMHhGRik7XHJcbiAgICByZXR1cm4gb3V0cHV0O1xyXG4gIH1cclxufSIsImV4cG9ydCBkZWZhdWx0IGNsYXNzIFV0aWxzIHtcbiAgc3RhdGljIHNoYWxsb3dDb3B5KG86IGFueSk6IGFueSB7XG4gICAgY29uc3QgbjogYW55ID0ge307XG4gICAgZm9yICh2YXIgayBpbiBvKSB7XG4gICAgICBuW2tdID0gb1trXTtcbiAgICB9XG4gICAgcmV0dXJuIG47XG4gIH1cbn0iLCJleHBvcnQgZGVmYXVsdCBjbGFzcyBWb2Ige1xuICBvZmZzZXQ6IG51bWJlcjtcbiAgYmxvY2s6IG51bWJlcjtcbiAgXG4gIGNvbnN0cnVjdG9yKGI6IG51bWJlciwgbzogbnVtYmVyKSB7XG4gICAgdGhpcy5ibG9jayA9IGI7XG4gICAgdGhpcy5vZmZzZXQgPSBvO1xuICB9XG5cbiAgdG9TdHJpbmcoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gJycgKyB0aGlzLmJsb2NrICsgJzonICsgdGhpcy5vZmZzZXQ7XG4gIH1cblxuICBzdGF0aWMgZmFjdG9yeShiYTogVWludDhBcnJheSwgb2Zmc2V0OiBudW1iZXIpOiBWb2Ige1xuICAgIHZhciBibG9jayA9ICgoYmFbb2Zmc2V0KzZdICYgMHhmZikgKiAweDEwMDAwMDAwMCkgKyAoKGJhW29mZnNldCs1XSAmIDB4ZmYpICogMHgxMDAwMDAwKSArICgoYmFbb2Zmc2V0KzRdICYgMHhmZikgKiAweDEwMDAwKSArICgoYmFbb2Zmc2V0KzNdICYgMHhmZikgKiAweDEwMCkgKyAoKGJhW29mZnNldCsyXSAmIDB4ZmYpKTtcbiAgICB2YXIgYmludCA9IChiYVtvZmZzZXQrMV0gPDwgOCkgfCAoYmFbb2Zmc2V0XSk7XG4gICAgaWYgKGJsb2NrID09IDAgJiYgYmludCA9PSAwKSB7XG4gICAgICAgIHJldHVybiBudWxsOyAgLy8gU2hvdWxkIG9ubHkgaGFwcGVuIGluIHRoZSBsaW5lYXIgaW5kZXg/XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIG5ldyBWb2IoYmxvY2ssIGJpbnQpO1xuICAgIH1cbiAgfVxufVxuXG5cblxuXG4iLCIvKiAtKi0gbW9kZTogamF2YXNjcmlwdDsgYy1iYXNpYy1vZmZzZXQ6IDQ7IGluZGVudC10YWJzLW1vZGU6IG5pbCAtKi0gKi9cblxuLy8gXG4vLyBKYXZhc2NyaXB0IFpMaWJcbi8vIEJ5IFRob21hcyBEb3duIDIwMTAtMjAxMVxuLy9cbi8vIEJhc2VkIHZlcnkgaGVhdmlseSBvbiBwb3J0aW9ucyBvZiBqemxpYiAoYnkgeW1ua0BqY3JhZnQuY29tKSwgd2hvIGluXG4vLyB0dXJuIGNyZWRpdHMgSmVhbi1sb3VwIEdhaWxseSBhbmQgTWFyayBBZGxlciBmb3IgdGhlIG9yaWdpbmFsIHpsaWIgY29kZS5cbi8vXG4vLyBpbmZsYXRlLmpzOiBaTGliIGluZmxhdGUgY29kZVxuLy9cblxuLy9cbi8vIFNoYXJlZCBjb25zdGFudHNcbi8vXG5cbnZhciBNQVhfV0JJVFM9MTU7IC8vIDMySyBMWjc3IHdpbmRvd1xudmFyIERFRl9XQklUUz1NQVhfV0JJVFM7XG52YXIgTUFYX01FTV9MRVZFTD05O1xudmFyIE1BTlk9MTQ0MDtcbnZhciBCTUFYID0gMTU7XG5cbi8vIHByZXNldCBkaWN0aW9uYXJ5IGZsYWcgaW4gemxpYiBoZWFkZXJcbnZhciBQUkVTRVRfRElDVD0weDIwO1xuXG52YXIgWl9OT19GTFVTSD0wO1xudmFyIFpfUEFSVElBTF9GTFVTSD0xO1xudmFyIFpfU1lOQ19GTFVTSD0yO1xudmFyIFpfRlVMTF9GTFVTSD0zO1xudmFyIFpfRklOSVNIPTQ7XG5cbnZhciBaX0RFRkxBVEVEPTg7XG5cbnZhciBaX09LPTA7XG52YXIgWl9TVFJFQU1fRU5EPTE7XG52YXIgWl9ORUVEX0RJQ1Q9MjtcbnZhciBaX0VSUk5PPS0xO1xudmFyIFpfU1RSRUFNX0VSUk9SPS0yO1xudmFyIFpfREFUQV9FUlJPUj0tMztcbnZhciBaX01FTV9FUlJPUj0tNDtcbnZhciBaX0JVRl9FUlJPUj0tNTtcbnZhciBaX1ZFUlNJT05fRVJST1I9LTY7XG5cbnZhciBNRVRIT0Q9MDsgICAvLyB3YWl0aW5nIGZvciBtZXRob2QgYnl0ZVxudmFyIEZMQUc9MTsgICAgIC8vIHdhaXRpbmcgZm9yIGZsYWcgYnl0ZVxudmFyIERJQ1Q0PTI7ICAgIC8vIGZvdXIgZGljdGlvbmFyeSBjaGVjayBieXRlcyB0byBnb1xudmFyIERJQ1QzPTM7ICAgIC8vIHRocmVlIGRpY3Rpb25hcnkgY2hlY2sgYnl0ZXMgdG8gZ29cbnZhciBESUNUMj00OyAgICAvLyB0d28gZGljdGlvbmFyeSBjaGVjayBieXRlcyB0byBnb1xudmFyIERJQ1QxPTU7ICAgIC8vIG9uZSBkaWN0aW9uYXJ5IGNoZWNrIGJ5dGUgdG8gZ29cbnZhciBESUNUMD02OyAgICAvLyB3YWl0aW5nIGZvciBpbmZsYXRlU2V0RGljdGlvbmFyeVxudmFyIEJMT0NLUz03OyAgIC8vIGRlY29tcHJlc3NpbmcgYmxvY2tzXG52YXIgQ0hFQ0s0PTg7ICAgLy8gZm91ciBjaGVjayBieXRlcyB0byBnb1xudmFyIENIRUNLMz05OyAgIC8vIHRocmVlIGNoZWNrIGJ5dGVzIHRvIGdvXG52YXIgQ0hFQ0syPTEwOyAgLy8gdHdvIGNoZWNrIGJ5dGVzIHRvIGdvXG52YXIgQ0hFQ0sxPTExOyAgLy8gb25lIGNoZWNrIGJ5dGUgdG8gZ29cbnZhciBET05FPTEyOyAgICAvLyBmaW5pc2hlZCBjaGVjaywgZG9uZVxudmFyIEJBRD0xMzsgICAgIC8vIGdvdCBhbiBlcnJvci0tc3RheSBoZXJlXG5cbnZhciBpbmZsYXRlX21hc2sgPSBbMHgwMDAwMDAwMCwgMHgwMDAwMDAwMSwgMHgwMDAwMDAwMywgMHgwMDAwMDAwNywgMHgwMDAwMDAwZiwgMHgwMDAwMDAxZiwgMHgwMDAwMDAzZiwgMHgwMDAwMDA3ZiwgMHgwMDAwMDBmZiwgMHgwMDAwMDFmZiwgMHgwMDAwMDNmZiwgMHgwMDAwMDdmZiwgMHgwMDAwMGZmZiwgMHgwMDAwMWZmZiwgMHgwMDAwM2ZmZiwgMHgwMDAwN2ZmZiwgMHgwMDAwZmZmZl07XG5cbnZhciBJQl9UWVBFPTA7ICAvLyBnZXQgdHlwZSBiaXRzICgzLCBpbmNsdWRpbmcgZW5kIGJpdClcbnZhciBJQl9MRU5TPTE7ICAvLyBnZXQgbGVuZ3RocyBmb3Igc3RvcmVkXG52YXIgSUJfU1RPUkVEPTI7Ly8gcHJvY2Vzc2luZyBzdG9yZWQgYmxvY2tcbnZhciBJQl9UQUJMRT0zOyAvLyBnZXQgdGFibGUgbGVuZ3Roc1xudmFyIElCX0JUUkVFPTQ7IC8vIGdldCBiaXQgbGVuZ3RocyB0cmVlIGZvciBhIGR5bmFtaWMgYmxvY2tcbnZhciBJQl9EVFJFRT01OyAvLyBnZXQgbGVuZ3RoLCBkaXN0YW5jZSB0cmVlcyBmb3IgYSBkeW5hbWljIGJsb2NrXG52YXIgSUJfQ09ERVM9NjsgLy8gcHJvY2Vzc2luZyBmaXhlZCBvciBkeW5hbWljIGJsb2NrXG52YXIgSUJfRFJZPTc7ICAgLy8gb3V0cHV0IHJlbWFpbmluZyB3aW5kb3cgYnl0ZXNcbnZhciBJQl9ET05FPTg7ICAvLyBmaW5pc2hlZCBsYXN0IGJsb2NrLCBkb25lXG52YXIgSUJfQkFEPTk7ICAgLy8gb3QgYSBkYXRhIGVycm9yLS1zdHVjayBoZXJlXG5cbnZhciBmaXhlZF9ibCA9IDk7XG52YXIgZml4ZWRfYmQgPSA1O1xuXG52YXIgZml4ZWRfdGwgPSBbXG4gICAgOTYsNywyNTYsIDAsOCw4MCwgMCw4LDE2LCA4NCw4LDExNSxcbiAgICA4Miw3LDMxLCAwLDgsMTEyLCAwLDgsNDgsIDAsOSwxOTIsXG4gICAgODAsNywxMCwgMCw4LDk2LCAwLDgsMzIsIDAsOSwxNjAsXG4gICAgMCw4LDAsIDAsOCwxMjgsIDAsOCw2NCwgMCw5LDIyNCxcbiAgICA4MCw3LDYsIDAsOCw4OCwgMCw4LDI0LCAwLDksMTQ0LFxuICAgIDgzLDcsNTksIDAsOCwxMjAsIDAsOCw1NiwgMCw5LDIwOCxcbiAgICA4MSw3LDE3LCAwLDgsMTA0LCAwLDgsNDAsIDAsOSwxNzYsXG4gICAgMCw4LDgsIDAsOCwxMzYsIDAsOCw3MiwgMCw5LDI0MCxcbiAgICA4MCw3LDQsIDAsOCw4NCwgMCw4LDIwLCA4NSw4LDIyNyxcbiAgICA4Myw3LDQzLCAwLDgsMTE2LCAwLDgsNTIsIDAsOSwyMDAsXG4gICAgODEsNywxMywgMCw4LDEwMCwgMCw4LDM2LCAwLDksMTY4LFxuICAgIDAsOCw0LCAwLDgsMTMyLCAwLDgsNjgsIDAsOSwyMzIsXG4gICAgODAsNyw4LCAwLDgsOTIsIDAsOCwyOCwgMCw5LDE1MixcbiAgICA4NCw3LDgzLCAwLDgsMTI0LCAwLDgsNjAsIDAsOSwyMTYsXG4gICAgODIsNywyMywgMCw4LDEwOCwgMCw4LDQ0LCAwLDksMTg0LFxuICAgIDAsOCwxMiwgMCw4LDE0MCwgMCw4LDc2LCAwLDksMjQ4LFxuICAgIDgwLDcsMywgMCw4LDgyLCAwLDgsMTgsIDg1LDgsMTYzLFxuICAgIDgzLDcsMzUsIDAsOCwxMTQsIDAsOCw1MCwgMCw5LDE5NixcbiAgICA4MSw3LDExLCAwLDgsOTgsIDAsOCwzNCwgMCw5LDE2NCxcbiAgICAwLDgsMiwgMCw4LDEzMCwgMCw4LDY2LCAwLDksMjI4LFxuICAgIDgwLDcsNywgMCw4LDkwLCAwLDgsMjYsIDAsOSwxNDgsXG4gICAgODQsNyw2NywgMCw4LDEyMiwgMCw4LDU4LCAwLDksMjEyLFxuICAgIDgyLDcsMTksIDAsOCwxMDYsIDAsOCw0MiwgMCw5LDE4MCxcbiAgICAwLDgsMTAsIDAsOCwxMzgsIDAsOCw3NCwgMCw5LDI0NCxcbiAgICA4MCw3LDUsIDAsOCw4NiwgMCw4LDIyLCAxOTIsOCwwLFxuICAgIDgzLDcsNTEsIDAsOCwxMTgsIDAsOCw1NCwgMCw5LDIwNCxcbiAgICA4MSw3LDE1LCAwLDgsMTAyLCAwLDgsMzgsIDAsOSwxNzIsXG4gICAgMCw4LDYsIDAsOCwxMzQsIDAsOCw3MCwgMCw5LDIzNixcbiAgICA4MCw3LDksIDAsOCw5NCwgMCw4LDMwLCAwLDksMTU2LFxuICAgIDg0LDcsOTksIDAsOCwxMjYsIDAsOCw2MiwgMCw5LDIyMCxcbiAgICA4Miw3LDI3LCAwLDgsMTEwLCAwLDgsNDYsIDAsOSwxODgsXG4gICAgMCw4LDE0LCAwLDgsMTQyLCAwLDgsNzgsIDAsOSwyNTIsXG4gICAgOTYsNywyNTYsIDAsOCw4MSwgMCw4LDE3LCA4NSw4LDEzMSxcbiAgICA4Miw3LDMxLCAwLDgsMTEzLCAwLDgsNDksIDAsOSwxOTQsXG4gICAgODAsNywxMCwgMCw4LDk3LCAwLDgsMzMsIDAsOSwxNjIsXG4gICAgMCw4LDEsIDAsOCwxMjksIDAsOCw2NSwgMCw5LDIyNixcbiAgICA4MCw3LDYsIDAsOCw4OSwgMCw4LDI1LCAwLDksMTQ2LFxuICAgIDgzLDcsNTksIDAsOCwxMjEsIDAsOCw1NywgMCw5LDIxMCxcbiAgICA4MSw3LDE3LCAwLDgsMTA1LCAwLDgsNDEsIDAsOSwxNzgsXG4gICAgMCw4LDksIDAsOCwxMzcsIDAsOCw3MywgMCw5LDI0MixcbiAgICA4MCw3LDQsIDAsOCw4NSwgMCw4LDIxLCA4MCw4LDI1OCxcbiAgICA4Myw3LDQzLCAwLDgsMTE3LCAwLDgsNTMsIDAsOSwyMDIsXG4gICAgODEsNywxMywgMCw4LDEwMSwgMCw4LDM3LCAwLDksMTcwLFxuICAgIDAsOCw1LCAwLDgsMTMzLCAwLDgsNjksIDAsOSwyMzQsXG4gICAgODAsNyw4LCAwLDgsOTMsIDAsOCwyOSwgMCw5LDE1NCxcbiAgICA4NCw3LDgzLCAwLDgsMTI1LCAwLDgsNjEsIDAsOSwyMTgsXG4gICAgODIsNywyMywgMCw4LDEwOSwgMCw4LDQ1LCAwLDksMTg2LFxuICAgIDAsOCwxMywgMCw4LDE0MSwgMCw4LDc3LCAwLDksMjUwLFxuICAgIDgwLDcsMywgMCw4LDgzLCAwLDgsMTksIDg1LDgsMTk1LFxuICAgIDgzLDcsMzUsIDAsOCwxMTUsIDAsOCw1MSwgMCw5LDE5OCxcbiAgICA4MSw3LDExLCAwLDgsOTksIDAsOCwzNSwgMCw5LDE2NixcbiAgICAwLDgsMywgMCw4LDEzMSwgMCw4LDY3LCAwLDksMjMwLFxuICAgIDgwLDcsNywgMCw4LDkxLCAwLDgsMjcsIDAsOSwxNTAsXG4gICAgODQsNyw2NywgMCw4LDEyMywgMCw4LDU5LCAwLDksMjE0LFxuICAgIDgyLDcsMTksIDAsOCwxMDcsIDAsOCw0MywgMCw5LDE4MixcbiAgICAwLDgsMTEsIDAsOCwxMzksIDAsOCw3NSwgMCw5LDI0NixcbiAgICA4MCw3LDUsIDAsOCw4NywgMCw4LDIzLCAxOTIsOCwwLFxuICAgIDgzLDcsNTEsIDAsOCwxMTksIDAsOCw1NSwgMCw5LDIwNixcbiAgICA4MSw3LDE1LCAwLDgsMTAzLCAwLDgsMzksIDAsOSwxNzQsXG4gICAgMCw4LDcsIDAsOCwxMzUsIDAsOCw3MSwgMCw5LDIzOCxcbiAgICA4MCw3LDksIDAsOCw5NSwgMCw4LDMxLCAwLDksMTU4LFxuICAgIDg0LDcsOTksIDAsOCwxMjcsIDAsOCw2MywgMCw5LDIyMixcbiAgICA4Miw3LDI3LCAwLDgsMTExLCAwLDgsNDcsIDAsOSwxOTAsXG4gICAgMCw4LDE1LCAwLDgsMTQzLCAwLDgsNzksIDAsOSwyNTQsXG4gICAgOTYsNywyNTYsIDAsOCw4MCwgMCw4LDE2LCA4NCw4LDExNSxcbiAgICA4Miw3LDMxLCAwLDgsMTEyLCAwLDgsNDgsIDAsOSwxOTMsXG5cbiAgICA4MCw3LDEwLCAwLDgsOTYsIDAsOCwzMiwgMCw5LDE2MSxcbiAgICAwLDgsMCwgMCw4LDEyOCwgMCw4LDY0LCAwLDksMjI1LFxuICAgIDgwLDcsNiwgMCw4LDg4LCAwLDgsMjQsIDAsOSwxNDUsXG4gICAgODMsNyw1OSwgMCw4LDEyMCwgMCw4LDU2LCAwLDksMjA5LFxuICAgIDgxLDcsMTcsIDAsOCwxMDQsIDAsOCw0MCwgMCw5LDE3NyxcbiAgICAwLDgsOCwgMCw4LDEzNiwgMCw4LDcyLCAwLDksMjQxLFxuICAgIDgwLDcsNCwgMCw4LDg0LCAwLDgsMjAsIDg1LDgsMjI3LFxuICAgIDgzLDcsNDMsIDAsOCwxMTYsIDAsOCw1MiwgMCw5LDIwMSxcbiAgICA4MSw3LDEzLCAwLDgsMTAwLCAwLDgsMzYsIDAsOSwxNjksXG4gICAgMCw4LDQsIDAsOCwxMzIsIDAsOCw2OCwgMCw5LDIzMyxcbiAgICA4MCw3LDgsIDAsOCw5MiwgMCw4LDI4LCAwLDksMTUzLFxuICAgIDg0LDcsODMsIDAsOCwxMjQsIDAsOCw2MCwgMCw5LDIxNyxcbiAgICA4Miw3LDIzLCAwLDgsMTA4LCAwLDgsNDQsIDAsOSwxODUsXG4gICAgMCw4LDEyLCAwLDgsMTQwLCAwLDgsNzYsIDAsOSwyNDksXG4gICAgODAsNywzLCAwLDgsODIsIDAsOCwxOCwgODUsOCwxNjMsXG4gICAgODMsNywzNSwgMCw4LDExNCwgMCw4LDUwLCAwLDksMTk3LFxuICAgIDgxLDcsMTEsIDAsOCw5OCwgMCw4LDM0LCAwLDksMTY1LFxuICAgIDAsOCwyLCAwLDgsMTMwLCAwLDgsNjYsIDAsOSwyMjksXG4gICAgODAsNyw3LCAwLDgsOTAsIDAsOCwyNiwgMCw5LDE0OSxcbiAgICA4NCw3LDY3LCAwLDgsMTIyLCAwLDgsNTgsIDAsOSwyMTMsXG4gICAgODIsNywxOSwgMCw4LDEwNiwgMCw4LDQyLCAwLDksMTgxLFxuICAgIDAsOCwxMCwgMCw4LDEzOCwgMCw4LDc0LCAwLDksMjQ1LFxuICAgIDgwLDcsNSwgMCw4LDg2LCAwLDgsMjIsIDE5Miw4LDAsXG4gICAgODMsNyw1MSwgMCw4LDExOCwgMCw4LDU0LCAwLDksMjA1LFxuICAgIDgxLDcsMTUsIDAsOCwxMDIsIDAsOCwzOCwgMCw5LDE3MyxcbiAgICAwLDgsNiwgMCw4LDEzNCwgMCw4LDcwLCAwLDksMjM3LFxuICAgIDgwLDcsOSwgMCw4LDk0LCAwLDgsMzAsIDAsOSwxNTcsXG4gICAgODQsNyw5OSwgMCw4LDEyNiwgMCw4LDYyLCAwLDksMjIxLFxuICAgIDgyLDcsMjcsIDAsOCwxMTAsIDAsOCw0NiwgMCw5LDE4OSxcbiAgICAwLDgsMTQsIDAsOCwxNDIsIDAsOCw3OCwgMCw5LDI1MyxcbiAgICA5Niw3LDI1NiwgMCw4LDgxLCAwLDgsMTcsIDg1LDgsMTMxLFxuICAgIDgyLDcsMzEsIDAsOCwxMTMsIDAsOCw0OSwgMCw5LDE5NSxcbiAgICA4MCw3LDEwLCAwLDgsOTcsIDAsOCwzMywgMCw5LDE2MyxcbiAgICAwLDgsMSwgMCw4LDEyOSwgMCw4LDY1LCAwLDksMjI3LFxuICAgIDgwLDcsNiwgMCw4LDg5LCAwLDgsMjUsIDAsOSwxNDcsXG4gICAgODMsNyw1OSwgMCw4LDEyMSwgMCw4LDU3LCAwLDksMjExLFxuICAgIDgxLDcsMTcsIDAsOCwxMDUsIDAsOCw0MSwgMCw5LDE3OSxcbiAgICAwLDgsOSwgMCw4LDEzNywgMCw4LDczLCAwLDksMjQzLFxuICAgIDgwLDcsNCwgMCw4LDg1LCAwLDgsMjEsIDgwLDgsMjU4LFxuICAgIDgzLDcsNDMsIDAsOCwxMTcsIDAsOCw1MywgMCw5LDIwMyxcbiAgICA4MSw3LDEzLCAwLDgsMTAxLCAwLDgsMzcsIDAsOSwxNzEsXG4gICAgMCw4LDUsIDAsOCwxMzMsIDAsOCw2OSwgMCw5LDIzNSxcbiAgICA4MCw3LDgsIDAsOCw5MywgMCw4LDI5LCAwLDksMTU1LFxuICAgIDg0LDcsODMsIDAsOCwxMjUsIDAsOCw2MSwgMCw5LDIxOSxcbiAgICA4Miw3LDIzLCAwLDgsMTA5LCAwLDgsNDUsIDAsOSwxODcsXG4gICAgMCw4LDEzLCAwLDgsMTQxLCAwLDgsNzcsIDAsOSwyNTEsXG4gICAgODAsNywzLCAwLDgsODMsIDAsOCwxOSwgODUsOCwxOTUsXG4gICAgODMsNywzNSwgMCw4LDExNSwgMCw4LDUxLCAwLDksMTk5LFxuICAgIDgxLDcsMTEsIDAsOCw5OSwgMCw4LDM1LCAwLDksMTY3LFxuICAgIDAsOCwzLCAwLDgsMTMxLCAwLDgsNjcsIDAsOSwyMzEsXG4gICAgODAsNyw3LCAwLDgsOTEsIDAsOCwyNywgMCw5LDE1MSxcbiAgICA4NCw3LDY3LCAwLDgsMTIzLCAwLDgsNTksIDAsOSwyMTUsXG4gICAgODIsNywxOSwgMCw4LDEwNywgMCw4LDQzLCAwLDksMTgzLFxuICAgIDAsOCwxMSwgMCw4LDEzOSwgMCw4LDc1LCAwLDksMjQ3LFxuICAgIDgwLDcsNSwgMCw4LDg3LCAwLDgsMjMsIDE5Miw4LDAsXG4gICAgODMsNyw1MSwgMCw4LDExOSwgMCw4LDU1LCAwLDksMjA3LFxuICAgIDgxLDcsMTUsIDAsOCwxMDMsIDAsOCwzOSwgMCw5LDE3NSxcbiAgICAwLDgsNywgMCw4LDEzNSwgMCw4LDcxLCAwLDksMjM5LFxuICAgIDgwLDcsOSwgMCw4LDk1LCAwLDgsMzEsIDAsOSwxNTksXG4gICAgODQsNyw5OSwgMCw4LDEyNywgMCw4LDYzLCAwLDksMjIzLFxuICAgIDgyLDcsMjcsIDAsOCwxMTEsIDAsOCw0NywgMCw5LDE5MSxcbiAgICAwLDgsMTUsIDAsOCwxNDMsIDAsOCw3OSwgMCw5LDI1NVxuXTtcbnZhciBmaXhlZF90ZCA9IFtcbiAgICA4MCw1LDEsIDg3LDUsMjU3LCA4Myw1LDE3LCA5MSw1LDQwOTcsXG4gICAgODEsNSw1LCA4OSw1LDEwMjUsIDg1LDUsNjUsIDkzLDUsMTYzODUsXG4gICAgODAsNSwzLCA4OCw1LDUxMywgODQsNSwzMywgOTIsNSw4MTkzLFxuICAgIDgyLDUsOSwgOTAsNSwyMDQ5LCA4Niw1LDEyOSwgMTkyLDUsMjQ1NzcsXG4gICAgODAsNSwyLCA4Nyw1LDM4NSwgODMsNSwyNSwgOTEsNSw2MTQ1LFxuICAgIDgxLDUsNywgODksNSwxNTM3LCA4NSw1LDk3LCA5Myw1LDI0NTc3LFxuICAgIDgwLDUsNCwgODgsNSw3NjksIDg0LDUsNDksIDkyLDUsMTIyODksXG4gICAgODIsNSwxMywgOTAsNSwzMDczLCA4Niw1LDE5MywgMTkyLDUsMjQ1Nzdcbl07XG5cbiAgLy8gVGFibGVzIGZvciBkZWZsYXRlIGZyb20gUEtaSVAncyBhcHBub3RlLnR4dC5cbiAgdmFyIGNwbGVucyA9IFsgLy8gQ29weSBsZW5ndGhzIGZvciBsaXRlcmFsIGNvZGVzIDI1Ny4uMjg1XG4gICAgICAgIDMsIDQsIDUsIDYsIDcsIDgsIDksIDEwLCAxMSwgMTMsIDE1LCAxNywgMTksIDIzLCAyNywgMzEsXG4gICAgICAgIDM1LCA0MywgNTEsIDU5LCA2NywgODMsIDk5LCAxMTUsIDEzMSwgMTYzLCAxOTUsIDIyNywgMjU4LCAwLCAwXG4gIF07XG5cbiAgLy8gc2VlIG5vdGUgIzEzIGFib3ZlIGFib3V0IDI1OFxuICB2YXIgY3BsZXh0ID0gWyAvLyBFeHRyYSBiaXRzIGZvciBsaXRlcmFsIGNvZGVzIDI1Ny4uMjg1XG4gICAgICAgIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDEsIDEsIDEsIDEsIDIsIDIsIDIsIDIsXG4gICAgICAgIDMsIDMsIDMsIDMsIDQsIDQsIDQsIDQsIDUsIDUsIDUsIDUsIDAsIDExMiwgMTEyICAvLyAxMTI9PWludmFsaWRcbiAgXTtcblxuIHZhciBjcGRpc3QgPSBbIC8vIENvcHkgb2Zmc2V0cyBmb3IgZGlzdGFuY2UgY29kZXMgMC4uMjlcbiAgICAgICAgMSwgMiwgMywgNCwgNSwgNywgOSwgMTMsIDE3LCAyNSwgMzMsIDQ5LCA2NSwgOTcsIDEyOSwgMTkzLFxuICAgICAgICAyNTcsIDM4NSwgNTEzLCA3NjksIDEwMjUsIDE1MzcsIDIwNDksIDMwNzMsIDQwOTcsIDYxNDUsXG4gICAgICAgIDgxOTMsIDEyMjg5LCAxNjM4NSwgMjQ1NzdcbiAgXTtcblxuICB2YXIgY3BkZXh0ID0gWyAvLyBFeHRyYSBiaXRzIGZvciBkaXN0YW5jZSBjb2Rlc1xuICAgICAgICAwLCAwLCAwLCAwLCAxLCAxLCAyLCAyLCAzLCAzLCA0LCA0LCA1LCA1LCA2LCA2LFxuICAgICAgICA3LCA3LCA4LCA4LCA5LCA5LCAxMCwgMTAsIDExLCAxMSxcbiAgICAgICAgMTIsIDEyLCAxMywgMTNdO1xuXG4vL1xuLy8gWlN0cmVhbS5qYXZhXG4vL1xuXG5mdW5jdGlvbiBaU3RyZWFtKCkge1xufVxuXG5cblpTdHJlYW0ucHJvdG90eXBlLmluZmxhdGVJbml0ID0gZnVuY3Rpb24odywgbm93cmFwKSB7XG4gICAgaWYgKCF3KSB7XG5cdHcgPSBERUZfV0JJVFM7XG4gICAgfVxuICAgIGlmIChub3dyYXApIHtcblx0bm93cmFwID0gZmFsc2U7XG4gICAgfVxuICAgIHRoaXMuaXN0YXRlID0gbmV3IEluZmxhdGUoKTtcbiAgICByZXR1cm4gdGhpcy5pc3RhdGUuaW5mbGF0ZUluaXQodGhpcywgbm93cmFwPy13OncpO1xufVxuXG5aU3RyZWFtLnByb3RvdHlwZS5pbmZsYXRlID0gZnVuY3Rpb24oZikge1xuICAgIGlmKHRoaXMuaXN0YXRlPT1udWxsKSByZXR1cm4gWl9TVFJFQU1fRVJST1I7XG4gICAgcmV0dXJuIHRoaXMuaXN0YXRlLmluZmxhdGUodGhpcywgZik7XG59XG5cblpTdHJlYW0ucHJvdG90eXBlLmluZmxhdGVFbmQgPSBmdW5jdGlvbigpe1xuICAgIGlmKHRoaXMuaXN0YXRlPT1udWxsKSByZXR1cm4gWl9TVFJFQU1fRVJST1I7XG4gICAgdmFyIHJldD1pc3RhdGUuaW5mbGF0ZUVuZCh0aGlzKTtcbiAgICB0aGlzLmlzdGF0ZSA9IG51bGw7XG4gICAgcmV0dXJuIHJldDtcbn1cblpTdHJlYW0ucHJvdG90eXBlLmluZmxhdGVTeW5jID0gZnVuY3Rpb24oKXtcbiAgICAvLyBpZihpc3RhdGUgPT0gbnVsbCkgcmV0dXJuIFpfU1RSRUFNX0VSUk9SO1xuICAgIHJldHVybiBpc3RhdGUuaW5mbGF0ZVN5bmModGhpcyk7XG59XG5aU3RyZWFtLnByb3RvdHlwZS5pbmZsYXRlU2V0RGljdGlvbmFyeSA9IGZ1bmN0aW9uKGRpY3Rpb25hcnksIGRpY3RMZW5ndGgpe1xuICAgIC8vIGlmKGlzdGF0ZSA9PSBudWxsKSByZXR1cm4gWl9TVFJFQU1fRVJST1I7XG4gICAgcmV0dXJuIGlzdGF0ZS5pbmZsYXRlU2V0RGljdGlvbmFyeSh0aGlzLCBkaWN0aW9uYXJ5LCBkaWN0TGVuZ3RoKTtcbn1cblxuLypcblxuICBwdWJsaWMgaW50IGRlZmxhdGVJbml0KGludCBsZXZlbCl7XG4gICAgcmV0dXJuIGRlZmxhdGVJbml0KGxldmVsLCBNQVhfV0JJVFMpO1xuICB9XG4gIHB1YmxpYyBpbnQgZGVmbGF0ZUluaXQoaW50IGxldmVsLCBib29sZWFuIG5vd3JhcCl7XG4gICAgcmV0dXJuIGRlZmxhdGVJbml0KGxldmVsLCBNQVhfV0JJVFMsIG5vd3JhcCk7XG4gIH1cbiAgcHVibGljIGludCBkZWZsYXRlSW5pdChpbnQgbGV2ZWwsIGludCBiaXRzKXtcbiAgICByZXR1cm4gZGVmbGF0ZUluaXQobGV2ZWwsIGJpdHMsIGZhbHNlKTtcbiAgfVxuICBwdWJsaWMgaW50IGRlZmxhdGVJbml0KGludCBsZXZlbCwgaW50IGJpdHMsIGJvb2xlYW4gbm93cmFwKXtcbiAgICBkc3RhdGU9bmV3IERlZmxhdGUoKTtcbiAgICByZXR1cm4gZHN0YXRlLmRlZmxhdGVJbml0KHRoaXMsIGxldmVsLCBub3dyYXA/LWJpdHM6Yml0cyk7XG4gIH1cbiAgcHVibGljIGludCBkZWZsYXRlKGludCBmbHVzaCl7XG4gICAgaWYoZHN0YXRlPT1udWxsKXtcbiAgICAgIHJldHVybiBaX1NUUkVBTV9FUlJPUjtcbiAgICB9XG4gICAgcmV0dXJuIGRzdGF0ZS5kZWZsYXRlKHRoaXMsIGZsdXNoKTtcbiAgfVxuICBwdWJsaWMgaW50IGRlZmxhdGVFbmQoKXtcbiAgICBpZihkc3RhdGU9PW51bGwpIHJldHVybiBaX1NUUkVBTV9FUlJPUjtcbiAgICBpbnQgcmV0PWRzdGF0ZS5kZWZsYXRlRW5kKCk7XG4gICAgZHN0YXRlPW51bGw7XG4gICAgcmV0dXJuIHJldDtcbiAgfVxuICBwdWJsaWMgaW50IGRlZmxhdGVQYXJhbXMoaW50IGxldmVsLCBpbnQgc3RyYXRlZ3kpe1xuICAgIGlmKGRzdGF0ZT09bnVsbCkgcmV0dXJuIFpfU1RSRUFNX0VSUk9SO1xuICAgIHJldHVybiBkc3RhdGUuZGVmbGF0ZVBhcmFtcyh0aGlzLCBsZXZlbCwgc3RyYXRlZ3kpO1xuICB9XG4gIHB1YmxpYyBpbnQgZGVmbGF0ZVNldERpY3Rpb25hcnkgKGJ5dGVbXSBkaWN0aW9uYXJ5LCBpbnQgZGljdExlbmd0aCl7XG4gICAgaWYoZHN0YXRlID09IG51bGwpXG4gICAgICByZXR1cm4gWl9TVFJFQU1fRVJST1I7XG4gICAgcmV0dXJuIGRzdGF0ZS5kZWZsYXRlU2V0RGljdGlvbmFyeSh0aGlzLCBkaWN0aW9uYXJ5LCBkaWN0TGVuZ3RoKTtcbiAgfVxuXG4qL1xuXG4vKlxuICAvLyBGbHVzaCBhcyBtdWNoIHBlbmRpbmcgb3V0cHV0IGFzIHBvc3NpYmxlLiBBbGwgZGVmbGF0ZSgpIG91dHB1dCBnb2VzXG4gIC8vIHRocm91Z2ggdGhpcyBmdW5jdGlvbiBzbyBzb21lIGFwcGxpY2F0aW9ucyBtYXkgd2lzaCB0byBtb2RpZnkgaXRcbiAgLy8gdG8gYXZvaWQgYWxsb2NhdGluZyBhIGxhcmdlIHN0cm0tPm5leHRfb3V0IGJ1ZmZlciBhbmQgY29weWluZyBpbnRvIGl0LlxuICAvLyAoU2VlIGFsc28gcmVhZF9idWYoKSkuXG4gIHZvaWQgZmx1c2hfcGVuZGluZygpe1xuICAgIGludCBsZW49ZHN0YXRlLnBlbmRpbmc7XG5cbiAgICBpZihsZW4+YXZhaWxfb3V0KSBsZW49YXZhaWxfb3V0O1xuICAgIGlmKGxlbj09MCkgcmV0dXJuO1xuXG4gICAgaWYoZHN0YXRlLnBlbmRpbmdfYnVmLmxlbmd0aDw9ZHN0YXRlLnBlbmRpbmdfb3V0IHx8XG4gICAgICAgbmV4dF9vdXQubGVuZ3RoPD1uZXh0X291dF9pbmRleCB8fFxuICAgICAgIGRzdGF0ZS5wZW5kaW5nX2J1Zi5sZW5ndGg8KGRzdGF0ZS5wZW5kaW5nX291dCtsZW4pIHx8XG4gICAgICAgbmV4dF9vdXQubGVuZ3RoPChuZXh0X291dF9pbmRleCtsZW4pKXtcbiAgICAgIFN5c3RlbS5vdXQucHJpbnRsbihkc3RhdGUucGVuZGluZ19idWYubGVuZ3RoK1wiLCBcIitkc3RhdGUucGVuZGluZ19vdXQrXG5cdFx0XHQgXCIsIFwiK25leHRfb3V0Lmxlbmd0aCtcIiwgXCIrbmV4dF9vdXRfaW5kZXgrXCIsIFwiK2xlbik7XG4gICAgICBTeXN0ZW0ub3V0LnByaW50bG4oXCJhdmFpbF9vdXQ9XCIrYXZhaWxfb3V0KTtcbiAgICB9XG5cbiAgICBTeXN0ZW0uYXJyYXljb3B5KGRzdGF0ZS5wZW5kaW5nX2J1ZiwgZHN0YXRlLnBlbmRpbmdfb3V0LFxuXHRcdCAgICAgbmV4dF9vdXQsIG5leHRfb3V0X2luZGV4LCBsZW4pO1xuXG4gICAgbmV4dF9vdXRfaW5kZXgrPWxlbjtcbiAgICBkc3RhdGUucGVuZGluZ19vdXQrPWxlbjtcbiAgICB0b3RhbF9vdXQrPWxlbjtcbiAgICBhdmFpbF9vdXQtPWxlbjtcbiAgICBkc3RhdGUucGVuZGluZy09bGVuO1xuICAgIGlmKGRzdGF0ZS5wZW5kaW5nPT0wKXtcbiAgICAgIGRzdGF0ZS5wZW5kaW5nX291dD0wO1xuICAgIH1cbiAgfVxuXG4gIC8vIFJlYWQgYSBuZXcgYnVmZmVyIGZyb20gdGhlIGN1cnJlbnQgaW5wdXQgc3RyZWFtLCB1cGRhdGUgdGhlIGFkbGVyMzJcbiAgLy8gYW5kIHRvdGFsIG51bWJlciBvZiBieXRlcyByZWFkLiAgQWxsIGRlZmxhdGUoKSBpbnB1dCBnb2VzIHRocm91Z2hcbiAgLy8gdGhpcyBmdW5jdGlvbiBzbyBzb21lIGFwcGxpY2F0aW9ucyBtYXkgd2lzaCB0byBtb2RpZnkgaXQgdG8gYXZvaWRcbiAgLy8gYWxsb2NhdGluZyBhIGxhcmdlIHN0cm0tPm5leHRfaW4gYnVmZmVyIGFuZCBjb3B5aW5nIGZyb20gaXQuXG4gIC8vIChTZWUgYWxzbyBmbHVzaF9wZW5kaW5nKCkpLlxuICBpbnQgcmVhZF9idWYoYnl0ZVtdIGJ1ZiwgaW50IHN0YXJ0LCBpbnQgc2l6ZSkge1xuICAgIGludCBsZW49YXZhaWxfaW47XG5cbiAgICBpZihsZW4+c2l6ZSkgbGVuPXNpemU7XG4gICAgaWYobGVuPT0wKSByZXR1cm4gMDtcblxuICAgIGF2YWlsX2luLT1sZW47XG5cbiAgICBpZihkc3RhdGUubm9oZWFkZXI9PTApIHtcbiAgICAgIGFkbGVyPV9hZGxlci5hZGxlcjMyKGFkbGVyLCBuZXh0X2luLCBuZXh0X2luX2luZGV4LCBsZW4pO1xuICAgIH1cbiAgICBTeXN0ZW0uYXJyYXljb3B5KG5leHRfaW4sIG5leHRfaW5faW5kZXgsIGJ1Ziwgc3RhcnQsIGxlbik7XG4gICAgbmV4dF9pbl9pbmRleCAgKz0gbGVuO1xuICAgIHRvdGFsX2luICs9IGxlbjtcbiAgICByZXR1cm4gbGVuO1xuICB9XG5cbiAgcHVibGljIHZvaWQgZnJlZSgpe1xuICAgIG5leHRfaW49bnVsbDtcbiAgICBuZXh0X291dD1udWxsO1xuICAgIG1zZz1udWxsO1xuICAgIF9hZGxlcj1udWxsO1xuICB9XG59XG4qL1xuXG5cbi8vXG4vLyBJbmZsYXRlLmphdmFcbi8vXG5cbmZ1bmN0aW9uIEluZmxhdGUoKSB7XG4gICAgdGhpcy53YXMgPSBbMF07XG59XG5cbkluZmxhdGUucHJvdG90eXBlLmluZmxhdGVSZXNldCA9IGZ1bmN0aW9uKHopIHtcbiAgICBpZih6ID09IG51bGwgfHwgei5pc3RhdGUgPT0gbnVsbCkgcmV0dXJuIFpfU1RSRUFNX0VSUk9SO1xuICAgIFxuICAgIHoudG90YWxfaW4gPSB6LnRvdGFsX291dCA9IDA7XG4gICAgei5tc2cgPSBudWxsO1xuICAgIHouaXN0YXRlLm1vZGUgPSB6LmlzdGF0ZS5ub3dyYXAhPTAgPyBCTE9DS1MgOiBNRVRIT0Q7XG4gICAgei5pc3RhdGUuYmxvY2tzLnJlc2V0KHosIG51bGwpO1xuICAgIHJldHVybiBaX09LO1xufVxuXG5JbmZsYXRlLnByb3RvdHlwZS5pbmZsYXRlRW5kID0gZnVuY3Rpb24oeil7XG4gICAgaWYodGhpcy5ibG9ja3MgIT0gbnVsbClcbiAgICAgIHRoaXMuYmxvY2tzLmZyZWUoeik7XG4gICAgdGhpcy5ibG9ja3M9bnVsbDtcbiAgICByZXR1cm4gWl9PSztcbn1cblxuSW5mbGF0ZS5wcm90b3R5cGUuaW5mbGF0ZUluaXQgPSBmdW5jdGlvbih6LCB3KXtcbiAgICB6Lm1zZyA9IG51bGw7XG4gICAgdGhpcy5ibG9ja3MgPSBudWxsO1xuXG4gICAgLy8gaGFuZGxlIHVuZG9jdW1lbnRlZCBub3dyYXAgb3B0aW9uIChubyB6bGliIGhlYWRlciBvciBjaGVjaylcbiAgICBub3dyYXAgPSAwO1xuICAgIGlmKHcgPCAwKXtcbiAgICAgIHcgPSAtIHc7XG4gICAgICBub3dyYXAgPSAxO1xuICAgIH1cblxuICAgIC8vIHNldCB3aW5kb3cgc2l6ZVxuICAgIGlmKHc8OCB8fHc+MTUpe1xuICAgICAgdGhpcy5pbmZsYXRlRW5kKHopO1xuICAgICAgcmV0dXJuIFpfU1RSRUFNX0VSUk9SO1xuICAgIH1cbiAgICB0aGlzLndiaXRzPXc7XG5cbiAgICB6LmlzdGF0ZS5ibG9ja3M9bmV3IEluZkJsb2Nrcyh6LCBcblx0XHRcdFx0ICB6LmlzdGF0ZS5ub3dyYXAhPTAgPyBudWxsIDogdGhpcyxcblx0XHRcdFx0ICAxPDx3KTtcblxuICAgIC8vIHJlc2V0IHN0YXRlXG4gICAgdGhpcy5pbmZsYXRlUmVzZXQoeik7XG4gICAgcmV0dXJuIFpfT0s7XG4gIH1cblxuSW5mbGF0ZS5wcm90b3R5cGUuaW5mbGF0ZSA9IGZ1bmN0aW9uKHosIGYpe1xuICAgIHZhciByLCBiO1xuXG4gICAgaWYoeiA9PSBudWxsIHx8IHouaXN0YXRlID09IG51bGwgfHwgei5uZXh0X2luID09IG51bGwpXG4gICAgICByZXR1cm4gWl9TVFJFQU1fRVJST1I7XG4gICAgZiA9IGYgPT0gWl9GSU5JU0ggPyBaX0JVRl9FUlJPUiA6IFpfT0s7XG4gICAgciA9IFpfQlVGX0VSUk9SO1xuICAgIHdoaWxlICh0cnVlKXtcbiAgICAgIHN3aXRjaCAoei5pc3RhdGUubW9kZSl7XG4gICAgICBjYXNlIE1FVEhPRDpcblxuICAgICAgICBpZih6LmF2YWlsX2luPT0wKXJldHVybiByO3I9ZjtcblxuICAgICAgICB6LmF2YWlsX2luLS07IHoudG90YWxfaW4rKztcbiAgICAgICAgaWYoKCh6LmlzdGF0ZS5tZXRob2QgPSB6Lm5leHRfaW5bei5uZXh0X2luX2luZGV4KytdKSYweGYpIT1aX0RFRkxBVEVEKXtcbiAgICAgICAgICB6LmlzdGF0ZS5tb2RlID0gQkFEO1xuICAgICAgICAgIHoubXNnPVwidW5rbm93biBjb21wcmVzc2lvbiBtZXRob2RcIjtcbiAgICAgICAgICB6LmlzdGF0ZS5tYXJrZXIgPSA1OyAgICAgICAvLyBjYW4ndCB0cnkgaW5mbGF0ZVN5bmNcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBpZigoei5pc3RhdGUubWV0aG9kPj40KSs4PnouaXN0YXRlLndiaXRzKXtcbiAgICAgICAgICB6LmlzdGF0ZS5tb2RlID0gQkFEO1xuICAgICAgICAgIHoubXNnPVwiaW52YWxpZCB3aW5kb3cgc2l6ZVwiO1xuICAgICAgICAgIHouaXN0YXRlLm1hcmtlciA9IDU7ICAgICAgIC8vIGNhbid0IHRyeSBpbmZsYXRlU3luY1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIHouaXN0YXRlLm1vZGU9RkxBRztcbiAgICAgIGNhc2UgRkxBRzpcblxuICAgICAgICBpZih6LmF2YWlsX2luPT0wKXJldHVybiByO3I9ZjtcblxuICAgICAgICB6LmF2YWlsX2luLS07IHoudG90YWxfaW4rKztcbiAgICAgICAgYiA9ICh6Lm5leHRfaW5bei5uZXh0X2luX2luZGV4KytdKSYweGZmO1xuXG4gICAgICAgIGlmKCgoKHouaXN0YXRlLm1ldGhvZCA8PCA4KStiKSAlIDMxKSE9MCl7XG4gICAgICAgICAgei5pc3RhdGUubW9kZSA9IEJBRDtcbiAgICAgICAgICB6Lm1zZyA9IFwiaW5jb3JyZWN0IGhlYWRlciBjaGVja1wiO1xuICAgICAgICAgIHouaXN0YXRlLm1hcmtlciA9IDU7ICAgICAgIC8vIGNhbid0IHRyeSBpbmZsYXRlU3luY1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoKGImUFJFU0VUX0RJQ1QpPT0wKXtcbiAgICAgICAgICB6LmlzdGF0ZS5tb2RlID0gQkxPQ0tTO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIHouaXN0YXRlLm1vZGUgPSBESUNUNDtcbiAgICAgIGNhc2UgRElDVDQ6XG5cbiAgICAgICAgaWYoei5hdmFpbF9pbj09MClyZXR1cm4gcjtyPWY7XG5cbiAgICAgICAgei5hdmFpbF9pbi0tOyB6LnRvdGFsX2luKys7XG4gICAgICAgIHouaXN0YXRlLm5lZWQ9KCh6Lm5leHRfaW5bei5uZXh0X2luX2luZGV4KytdJjB4ZmYpPDwyNCkmMHhmZjAwMDAwMDtcbiAgICAgICAgei5pc3RhdGUubW9kZT1ESUNUMztcbiAgICAgIGNhc2UgRElDVDM6XG5cbiAgICAgICAgaWYoei5hdmFpbF9pbj09MClyZXR1cm4gcjtyPWY7XG5cbiAgICAgICAgei5hdmFpbF9pbi0tOyB6LnRvdGFsX2luKys7XG4gICAgICAgIHouaXN0YXRlLm5lZWQrPSgoei5uZXh0X2luW3oubmV4dF9pbl9pbmRleCsrXSYweGZmKTw8MTYpJjB4ZmYwMDAwO1xuICAgICAgICB6LmlzdGF0ZS5tb2RlPURJQ1QyO1xuICAgICAgY2FzZSBESUNUMjpcblxuICAgICAgICBpZih6LmF2YWlsX2luPT0wKXJldHVybiByO3I9ZjtcblxuICAgICAgICB6LmF2YWlsX2luLS07IHoudG90YWxfaW4rKztcbiAgICAgICAgei5pc3RhdGUubmVlZCs9KCh6Lm5leHRfaW5bei5uZXh0X2luX2luZGV4KytdJjB4ZmYpPDw4KSYweGZmMDA7XG4gICAgICAgIHouaXN0YXRlLm1vZGU9RElDVDE7XG4gICAgICBjYXNlIERJQ1QxOlxuXG4gICAgICAgIGlmKHouYXZhaWxfaW49PTApcmV0dXJuIHI7cj1mO1xuXG4gICAgICAgIHouYXZhaWxfaW4tLTsgei50b3RhbF9pbisrO1xuICAgICAgICB6LmlzdGF0ZS5uZWVkICs9ICh6Lm5leHRfaW5bei5uZXh0X2luX2luZGV4KytdJjB4ZmYpO1xuICAgICAgICB6LmFkbGVyID0gei5pc3RhdGUubmVlZDtcbiAgICAgICAgei5pc3RhdGUubW9kZSA9IERJQ1QwO1xuICAgICAgICByZXR1cm4gWl9ORUVEX0RJQ1Q7XG4gICAgICBjYXNlIERJQ1QwOlxuICAgICAgICB6LmlzdGF0ZS5tb2RlID0gQkFEO1xuICAgICAgICB6Lm1zZyA9IFwibmVlZCBkaWN0aW9uYXJ5XCI7XG4gICAgICAgIHouaXN0YXRlLm1hcmtlciA9IDA7ICAgICAgIC8vIGNhbiB0cnkgaW5mbGF0ZVN5bmNcbiAgICAgICAgcmV0dXJuIFpfU1RSRUFNX0VSUk9SO1xuICAgICAgY2FzZSBCTE9DS1M6XG5cbiAgICAgICAgciA9IHouaXN0YXRlLmJsb2Nrcy5wcm9jKHosIHIpO1xuICAgICAgICBpZihyID09IFpfREFUQV9FUlJPUil7XG4gICAgICAgICAgei5pc3RhdGUubW9kZSA9IEJBRDtcbiAgICAgICAgICB6LmlzdGF0ZS5tYXJrZXIgPSAwOyAgICAgLy8gY2FuIHRyeSBpbmZsYXRlU3luY1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGlmKHIgPT0gWl9PSyl7XG4gICAgICAgICAgciA9IGY7XG4gICAgICAgIH1cbiAgICAgICAgaWYociAhPSBaX1NUUkVBTV9FTkQpe1xuICAgICAgICAgIHJldHVybiByO1xuICAgICAgICB9XG4gICAgICAgIHIgPSBmO1xuICAgICAgICB6LmlzdGF0ZS5ibG9ja3MucmVzZXQoeiwgei5pc3RhdGUud2FzKTtcbiAgICAgICAgaWYoei5pc3RhdGUubm93cmFwIT0wKXtcbiAgICAgICAgICB6LmlzdGF0ZS5tb2RlPURPTkU7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgei5pc3RhdGUubW9kZT1DSEVDSzQ7XG4gICAgICBjYXNlIENIRUNLNDpcblxuICAgICAgICBpZih6LmF2YWlsX2luPT0wKXJldHVybiByO3I9ZjtcblxuICAgICAgICB6LmF2YWlsX2luLS07IHoudG90YWxfaW4rKztcbiAgICAgICAgei5pc3RhdGUubmVlZD0oKHoubmV4dF9pblt6Lm5leHRfaW5faW5kZXgrK10mMHhmZik8PDI0KSYweGZmMDAwMDAwO1xuICAgICAgICB6LmlzdGF0ZS5tb2RlPUNIRUNLMztcbiAgICAgIGNhc2UgQ0hFQ0szOlxuXG4gICAgICAgIGlmKHouYXZhaWxfaW49PTApcmV0dXJuIHI7cj1mO1xuXG4gICAgICAgIHouYXZhaWxfaW4tLTsgei50b3RhbF9pbisrO1xuICAgICAgICB6LmlzdGF0ZS5uZWVkKz0oKHoubmV4dF9pblt6Lm5leHRfaW5faW5kZXgrK10mMHhmZik8PDE2KSYweGZmMDAwMDtcbiAgICAgICAgei5pc3RhdGUubW9kZSA9IENIRUNLMjtcbiAgICAgIGNhc2UgQ0hFQ0syOlxuXG4gICAgICAgIGlmKHouYXZhaWxfaW49PTApcmV0dXJuIHI7cj1mO1xuXG4gICAgICAgIHouYXZhaWxfaW4tLTsgei50b3RhbF9pbisrO1xuICAgICAgICB6LmlzdGF0ZS5uZWVkKz0oKHoubmV4dF9pblt6Lm5leHRfaW5faW5kZXgrK10mMHhmZik8PDgpJjB4ZmYwMDtcbiAgICAgICAgei5pc3RhdGUubW9kZSA9IENIRUNLMTtcbiAgICAgIGNhc2UgQ0hFQ0sxOlxuXG4gICAgICAgIGlmKHouYXZhaWxfaW49PTApcmV0dXJuIHI7cj1mO1xuXG4gICAgICAgIHouYXZhaWxfaW4tLTsgei50b3RhbF9pbisrO1xuICAgICAgICB6LmlzdGF0ZS5uZWVkKz0oei5uZXh0X2luW3oubmV4dF9pbl9pbmRleCsrXSYweGZmKTtcblxuICAgICAgICBpZigoKHouaXN0YXRlLndhc1swXSkpICE9ICgoei5pc3RhdGUubmVlZCkpKXtcbiAgICAgICAgICB6LmlzdGF0ZS5tb2RlID0gQkFEO1xuICAgICAgICAgIHoubXNnID0gXCJpbmNvcnJlY3QgZGF0YSBjaGVja1wiO1xuICAgICAgICAgIHouaXN0YXRlLm1hcmtlciA9IDU7ICAgICAgIC8vIGNhbid0IHRyeSBpbmZsYXRlU3luY1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgei5pc3RhdGUubW9kZSA9IERPTkU7XG4gICAgICBjYXNlIERPTkU6XG4gICAgICAgIHJldHVybiBaX1NUUkVBTV9FTkQ7XG4gICAgICBjYXNlIEJBRDpcbiAgICAgICAgcmV0dXJuIFpfREFUQV9FUlJPUjtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBaX1NUUkVBTV9FUlJPUjtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuXG5JbmZsYXRlLnByb3RvdHlwZS5pbmZsYXRlU2V0RGljdGlvbmFyeSA9IGZ1bmN0aW9uKHosICBkaWN0aW9uYXJ5LCBkaWN0TGVuZ3RoKSB7XG4gICAgdmFyIGluZGV4PTA7XG4gICAgdmFyIGxlbmd0aCA9IGRpY3RMZW5ndGg7XG4gICAgaWYoej09bnVsbCB8fCB6LmlzdGF0ZSA9PSBudWxsfHwgei5pc3RhdGUubW9kZSAhPSBESUNUMClcbiAgICAgIHJldHVybiBaX1NUUkVBTV9FUlJPUjtcblxuICAgIGlmKHouX2FkbGVyLmFkbGVyMzIoMSwgZGljdGlvbmFyeSwgMCwgZGljdExlbmd0aCkhPXouYWRsZXIpe1xuICAgICAgcmV0dXJuIFpfREFUQV9FUlJPUjtcbiAgICB9XG5cbiAgICB6LmFkbGVyID0gei5fYWRsZXIuYWRsZXIzMigwLCBudWxsLCAwLCAwKTtcblxuICAgIGlmKGxlbmd0aCA+PSAoMTw8ei5pc3RhdGUud2JpdHMpKXtcbiAgICAgIGxlbmd0aCA9ICgxPDx6LmlzdGF0ZS53Yml0cyktMTtcbiAgICAgIGluZGV4PWRpY3RMZW5ndGggLSBsZW5ndGg7XG4gICAgfVxuICAgIHouaXN0YXRlLmJsb2Nrcy5zZXRfZGljdGlvbmFyeShkaWN0aW9uYXJ5LCBpbmRleCwgbGVuZ3RoKTtcbiAgICB6LmlzdGF0ZS5tb2RlID0gQkxPQ0tTO1xuICAgIHJldHVybiBaX09LO1xuICB9XG5cbi8vICBzdGF0aWMgcHJpdmF0ZSBieXRlW10gbWFyayA9IHsoYnl0ZSkwLCAoYnl0ZSkwLCAoYnl0ZSkweGZmLCAoYnl0ZSkweGZmfTtcbnZhciBtYXJrID0gWzAsIDAsIDI1NSwgMjU1XVxuXG5JbmZsYXRlLnByb3RvdHlwZS5pbmZsYXRlU3luYyA9IGZ1bmN0aW9uKHope1xuICAgIHZhciBuOyAgICAgICAvLyBudW1iZXIgb2YgYnl0ZXMgdG8gbG9vayBhdFxuICAgIHZhciBwOyAgICAgICAvLyBwb2ludGVyIHRvIGJ5dGVzXG4gICAgdmFyIG07ICAgICAgIC8vIG51bWJlciBvZiBtYXJrZXIgYnl0ZXMgZm91bmQgaW4gYSByb3dcbiAgICB2YXIgciwgdzsgICAvLyB0ZW1wb3JhcmllcyB0byBzYXZlIHRvdGFsX2luIGFuZCB0b3RhbF9vdXRcblxuICAgIC8vIHNldCB1cFxuICAgIGlmKHogPT0gbnVsbCB8fCB6LmlzdGF0ZSA9PSBudWxsKVxuICAgICAgcmV0dXJuIFpfU1RSRUFNX0VSUk9SO1xuICAgIGlmKHouaXN0YXRlLm1vZGUgIT0gQkFEKXtcbiAgICAgIHouaXN0YXRlLm1vZGUgPSBCQUQ7XG4gICAgICB6LmlzdGF0ZS5tYXJrZXIgPSAwO1xuICAgIH1cbiAgICBpZigobj16LmF2YWlsX2luKT09MClcbiAgICAgIHJldHVybiBaX0JVRl9FUlJPUjtcbiAgICBwPXoubmV4dF9pbl9pbmRleDtcbiAgICBtPXouaXN0YXRlLm1hcmtlcjtcblxuICAgIC8vIHNlYXJjaFxuICAgIHdoaWxlIChuIT0wICYmIG0gPCA0KXtcbiAgICAgIGlmKHoubmV4dF9pbltwXSA9PSBtYXJrW21dKXtcbiAgICAgICAgbSsrO1xuICAgICAgfVxuICAgICAgZWxzZSBpZih6Lm5leHRfaW5bcF0hPTApe1xuICAgICAgICBtID0gMDtcbiAgICAgIH1cbiAgICAgIGVsc2V7XG4gICAgICAgIG0gPSA0IC0gbTtcbiAgICAgIH1cbiAgICAgIHArKzsgbi0tO1xuICAgIH1cblxuICAgIC8vIHJlc3RvcmVcbiAgICB6LnRvdGFsX2luICs9IHAtei5uZXh0X2luX2luZGV4O1xuICAgIHoubmV4dF9pbl9pbmRleCA9IHA7XG4gICAgei5hdmFpbF9pbiA9IG47XG4gICAgei5pc3RhdGUubWFya2VyID0gbTtcblxuICAgIC8vIHJldHVybiBubyBqb3kgb3Igc2V0IHVwIHRvIHJlc3RhcnQgb24gYSBuZXcgYmxvY2tcbiAgICBpZihtICE9IDQpe1xuICAgICAgcmV0dXJuIFpfREFUQV9FUlJPUjtcbiAgICB9XG4gICAgcj16LnRvdGFsX2luOyAgdz16LnRvdGFsX291dDtcbiAgICB0aGlzLmluZmxhdGVSZXNldCh6KTtcbiAgICB6LnRvdGFsX2luPXI7ICB6LnRvdGFsX291dCA9IHc7XG4gICAgei5pc3RhdGUubW9kZSA9IEJMT0NLUztcbiAgICByZXR1cm4gWl9PSztcbn1cblxuICAvLyBSZXR1cm5zIHRydWUgaWYgaW5mbGF0ZSBpcyBjdXJyZW50bHkgYXQgdGhlIGVuZCBvZiBhIGJsb2NrIGdlbmVyYXRlZFxuICAvLyBieSBaX1NZTkNfRkxVU0ggb3IgWl9GVUxMX0ZMVVNILiBUaGlzIGZ1bmN0aW9uIGlzIHVzZWQgYnkgb25lIFBQUFxuICAvLyBpbXBsZW1lbnRhdGlvbiB0byBwcm92aWRlIGFuIGFkZGl0aW9uYWwgc2FmZXR5IGNoZWNrLiBQUFAgdXNlcyBaX1NZTkNfRkxVU0hcbiAgLy8gYnV0IHJlbW92ZXMgdGhlIGxlbmd0aCBieXRlcyBvZiB0aGUgcmVzdWx0aW5nIGVtcHR5IHN0b3JlZCBibG9jay4gV2hlblxuICAvLyBkZWNvbXByZXNzaW5nLCBQUFAgY2hlY2tzIHRoYXQgYXQgdGhlIGVuZCBvZiBpbnB1dCBwYWNrZXQsIGluZmxhdGUgaXNcbiAgLy8gd2FpdGluZyBmb3IgdGhlc2UgbGVuZ3RoIGJ5dGVzLlxuSW5mbGF0ZS5wcm90b3R5cGUuaW5mbGF0ZVN5bmNQb2ludCA9IGZ1bmN0aW9uKHope1xuICAgIGlmKHogPT0gbnVsbCB8fCB6LmlzdGF0ZSA9PSBudWxsIHx8IHouaXN0YXRlLmJsb2NrcyA9PSBudWxsKVxuICAgICAgcmV0dXJuIFpfU1RSRUFNX0VSUk9SO1xuICAgIHJldHVybiB6LmlzdGF0ZS5ibG9ja3Muc3luY19wb2ludCgpO1xufVxuXG5cbi8vXG4vLyBJbmZCbG9ja3MuamF2YVxuLy9cblxudmFyIElORkJMT0NLU19CT1JERVIgPSBbMTYsIDE3LCAxOCwgMCwgOCwgNywgOSwgNiwgMTAsIDUsIDExLCA0LCAxMiwgMywgMTMsIDIsIDE0LCAxLCAxNV07XG5cbmZ1bmN0aW9uIEluZkJsb2Nrcyh6LCBjaGVja2ZuLCB3KSB7XG4gICAgdGhpcy5odWZ0cz1uZXcgSW50MzJBcnJheShNQU5ZKjMpO1xuICAgIHRoaXMud2luZG93PW5ldyBVaW50OEFycmF5KHcpO1xuICAgIHRoaXMuZW5kPXc7XG4gICAgdGhpcy5jaGVja2ZuID0gY2hlY2tmbjtcbiAgICB0aGlzLm1vZGUgPSBJQl9UWVBFO1xuICAgIHRoaXMucmVzZXQoeiwgbnVsbCk7XG5cbiAgICB0aGlzLmxlZnQgPSAwOyAgICAgICAgICAgIC8vIGlmIFNUT1JFRCwgYnl0ZXMgbGVmdCB0byBjb3B5IFxuXG4gICAgdGhpcy50YWJsZSA9IDA7ICAgICAgICAgICAvLyB0YWJsZSBsZW5ndGhzICgxNCBiaXRzKSBcbiAgICB0aGlzLmluZGV4ID0gMDsgICAgICAgICAgIC8vIGluZGV4IGludG8gYmxlbnMgKG9yIGJvcmRlcikgXG4gICAgdGhpcy5ibGVucyA9IG51bGw7ICAgICAgICAgLy8gYml0IGxlbmd0aHMgb2YgY29kZXMgXG4gICAgdGhpcy5iYj1uZXcgSW50MzJBcnJheSgxKTsgLy8gYml0IGxlbmd0aCB0cmVlIGRlcHRoIFxuICAgIHRoaXMudGI9bmV3IEludDMyQXJyYXkoMSk7IC8vIGJpdCBsZW5ndGggZGVjb2RpbmcgdHJlZSBcblxuICAgIHRoaXMuY29kZXMgPSBuZXcgSW5mQ29kZXMoKTtcblxuICAgIHRoaXMubGFzdCA9IDA7ICAgICAgICAgICAgLy8gdHJ1ZSBpZiB0aGlzIGJsb2NrIGlzIHRoZSBsYXN0IGJsb2NrIFxuXG4gIC8vIG1vZGUgaW5kZXBlbmRlbnQgaW5mb3JtYXRpb24gXG4gICAgdGhpcy5iaXRrID0gMDsgICAgICAgICAgICAvLyBiaXRzIGluIGJpdCBidWZmZXIgXG4gICAgdGhpcy5iaXRiID0gMDsgICAgICAgICAgICAvLyBiaXQgYnVmZmVyIFxuICAgIHRoaXMucmVhZCA9IDA7ICAgICAgICAgICAgLy8gd2luZG93IHJlYWQgcG9pbnRlciBcbiAgICB0aGlzLndyaXRlID0gMDsgICAgICAgICAgIC8vIHdpbmRvdyB3cml0ZSBwb2ludGVyIFxuICAgIHRoaXMuY2hlY2sgPSAwOyAgICAgICAgICAvLyBjaGVjayBvbiBvdXRwdXQgXG5cbiAgICB0aGlzLmluZnRyZWU9bmV3IEluZlRyZWUoKTtcbn1cblxuXG5cblxuSW5mQmxvY2tzLnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uKHosIGMpe1xuICAgIGlmKGMpIGNbMF09dGhpcy5jaGVjaztcbiAgICBpZih0aGlzLm1vZGU9PUlCX0NPREVTKXtcbiAgICAgIHRoaXMuY29kZXMuZnJlZSh6KTtcbiAgICB9XG4gICAgdGhpcy5tb2RlPUlCX1RZUEU7XG4gICAgdGhpcy5iaXRrPTA7XG4gICAgdGhpcy5iaXRiPTA7XG4gICAgdGhpcy5yZWFkPXRoaXMud3JpdGU9MDtcblxuICAgIGlmKHRoaXMuY2hlY2tmbilcbiAgICAgIHouYWRsZXI9dGhpcy5jaGVjaz16Ll9hZGxlci5hZGxlcjMyKDAsIG51bGwsIDAsIDApO1xuICB9XG5cbiBJbmZCbG9ja3MucHJvdG90eXBlLnByb2MgPSBmdW5jdGlvbih6LCByKXtcbiAgICB2YXIgdDsgICAgICAgICAgICAgIC8vIHRlbXBvcmFyeSBzdG9yYWdlXG4gICAgdmFyIGI7ICAgICAgICAgICAgICAvLyBiaXQgYnVmZmVyXG4gICAgdmFyIGs7ICAgICAgICAgICAgICAvLyBiaXRzIGluIGJpdCBidWZmZXJcbiAgICB2YXIgcDsgICAgICAgICAgICAgIC8vIGlucHV0IGRhdGEgcG9pbnRlclxuICAgIHZhciBuOyAgICAgICAgICAgICAgLy8gYnl0ZXMgYXZhaWxhYmxlIHRoZXJlXG4gICAgdmFyIHE7ICAgICAgICAgICAgICAvLyBvdXRwdXQgd2luZG93IHdyaXRlIHBvaW50ZXJcbiAgICB2YXIgbTsgICAgICAgICAgICAgIC8vIGJ5dGVzIHRvIGVuZCBvZiB3aW5kb3cgb3IgcmVhZCBwb2ludGVyXG5cbiAgICAvLyBjb3B5IGlucHV0L291dHB1dCBpbmZvcm1hdGlvbiB0byBsb2NhbHMgKFVQREFURSBtYWNybyByZXN0b3JlcylcbiAgICB7cD16Lm5leHRfaW5faW5kZXg7bj16LmF2YWlsX2luO2I9dGhpcy5iaXRiO2s9dGhpcy5iaXRrO31cbiAgICB7cT10aGlzLndyaXRlO209KHE8dGhpcy5yZWFkID8gdGhpcy5yZWFkLXEtMSA6IHRoaXMuZW5kLXEpO31cblxuICAgIC8vIHByb2Nlc3MgaW5wdXQgYmFzZWQgb24gY3VycmVudCBzdGF0ZVxuICAgIHdoaWxlKHRydWUpe1xuICAgICAgc3dpdGNoICh0aGlzLm1vZGUpe1xuICAgICAgY2FzZSBJQl9UWVBFOlxuXG5cdHdoaWxlKGs8KDMpKXtcblx0ICBpZihuIT0wKXtcblx0ICAgIHI9Wl9PSztcblx0ICB9XG5cdCAgZWxzZXtcblx0ICAgIHRoaXMuYml0Yj1iOyB0aGlzLmJpdGs9azsgXG5cdCAgICB6LmF2YWlsX2luPW47XG5cdCAgICB6LnRvdGFsX2luKz1wLXoubmV4dF9pbl9pbmRleDt6Lm5leHRfaW5faW5kZXg9cDtcblx0ICAgIHRoaXMud3JpdGU9cTtcblx0ICAgIHJldHVybiB0aGlzLmluZmxhdGVfZmx1c2goeixyKTtcblx0ICB9O1xuXHQgIG4tLTtcblx0ICBifD0oei5uZXh0X2luW3ArK10mMHhmZik8PGs7XG5cdCAgays9ODtcblx0fVxuXHR0ID0gKGIgJiA3KTtcblx0dGhpcy5sYXN0ID0gdCAmIDE7XG5cblx0c3dpdGNoICh0ID4+PiAxKXtcbiAgICAgICAgY2FzZSAwOiAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzdG9yZWQgXG4gICAgICAgICAge2I+Pj49KDMpO2stPSgzKTt9XG4gICAgICAgICAgdCA9IGsgJiA3OyAgICAgICAgICAgICAgICAgICAgLy8gZ28gdG8gYnl0ZSBib3VuZGFyeVxuXG4gICAgICAgICAge2I+Pj49KHQpO2stPSh0KTt9XG4gICAgICAgICAgdGhpcy5tb2RlID0gSUJfTEVOUzsgICAgICAgICAgICAgICAgICAvLyBnZXQgbGVuZ3RoIG9mIHN0b3JlZCBibG9ja1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDE6ICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZpeGVkXG4gICAgICAgICAge1xuICAgICAgICAgICAgICB2YXIgYmw9bmV3IEludDMyQXJyYXkoMSk7XG5cdCAgICAgIHZhciBiZD1uZXcgSW50MzJBcnJheSgxKTtcbiAgICAgICAgICAgICAgdmFyIHRsPVtdO1xuXHQgICAgICB2YXIgdGQ9W107XG5cblx0ICAgICAgaW5mbGF0ZV90cmVlc19maXhlZChibCwgYmQsIHRsLCB0ZCwgeik7XG4gICAgICAgICAgICAgIHRoaXMuY29kZXMuaW5pdChibFswXSwgYmRbMF0sIHRsWzBdLCAwLCB0ZFswXSwgMCwgeik7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAge2I+Pj49KDMpO2stPSgzKTt9XG5cbiAgICAgICAgICB0aGlzLm1vZGUgPSBJQl9DT0RFUztcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAyOiAgICAgICAgICAgICAgICAgICAgICAgICAvLyBkeW5hbWljXG5cbiAgICAgICAgICB7Yj4+Pj0oMyk7ay09KDMpO31cblxuICAgICAgICAgIHRoaXMubW9kZSA9IElCX1RBQkxFO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDM6ICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGlsbGVnYWxcblxuICAgICAgICAgIHtiPj4+PSgzKTtrLT0oMyk7fVxuICAgICAgICAgIHRoaXMubW9kZSA9IEJBRDtcbiAgICAgICAgICB6Lm1zZyA9IFwiaW52YWxpZCBibG9jayB0eXBlXCI7XG4gICAgICAgICAgciA9IFpfREFUQV9FUlJPUjtcblxuXHQgIHRoaXMuYml0Yj1iOyB0aGlzLmJpdGs9azsgXG5cdCAgei5hdmFpbF9pbj1uO3oudG90YWxfaW4rPXAtei5uZXh0X2luX2luZGV4O3oubmV4dF9pbl9pbmRleD1wO1xuXHQgIHRoaXMud3JpdGU9cTtcblx0ICByZXR1cm4gdGhpcy5pbmZsYXRlX2ZsdXNoKHoscik7XG5cdH1cblx0YnJlYWs7XG4gICAgICBjYXNlIElCX0xFTlM6XG5cdHdoaWxlKGs8KDMyKSl7XG5cdCAgaWYobiE9MCl7XG5cdCAgICByPVpfT0s7XG5cdCAgfVxuXHQgIGVsc2V7XG5cdCAgICB0aGlzLmJpdGI9YjsgdGhpcy5iaXRrPWs7IFxuXHQgICAgei5hdmFpbF9pbj1uO1xuXHQgICAgei50b3RhbF9pbis9cC16Lm5leHRfaW5faW5kZXg7ei5uZXh0X2luX2luZGV4PXA7XG5cdCAgICB0aGlzLndyaXRlPXE7XG5cdCAgICByZXR1cm4gdGhpcy5pbmZsYXRlX2ZsdXNoKHoscik7XG5cdCAgfTtcblx0ICBuLS07XG5cdCAgYnw9KHoubmV4dF9pbltwKytdJjB4ZmYpPDxrO1xuXHQgIGsrPTg7XG5cdH1cblxuXHRpZiAoKCgofmIpID4+PiAxNikgJiAweGZmZmYpICE9IChiICYgMHhmZmZmKSl7XG5cdCAgdGhpcy5tb2RlID0gQkFEO1xuXHQgIHoubXNnID0gXCJpbnZhbGlkIHN0b3JlZCBibG9jayBsZW5ndGhzXCI7XG5cdCAgciA9IFpfREFUQV9FUlJPUjtcblxuXHQgIHRoaXMuYml0Yj1iOyB0aGlzLmJpdGs9azsgXG5cdCAgei5hdmFpbF9pbj1uO3oudG90YWxfaW4rPXAtei5uZXh0X2luX2luZGV4O3oubmV4dF9pbl9pbmRleD1wO1xuXHQgIHRoaXMud3JpdGU9cTtcblx0ICByZXR1cm4gdGhpcy5pbmZsYXRlX2ZsdXNoKHoscik7XG5cdH1cblx0dGhpcy5sZWZ0ID0gKGIgJiAweGZmZmYpO1xuXHRiID0gayA9IDA7ICAgICAgICAgICAgICAgICAgICAgICAvLyBkdW1wIGJpdHNcblx0dGhpcy5tb2RlID0gdGhpcy5sZWZ0IT0wID8gSUJfU1RPUkVEIDogKHRoaXMubGFzdCE9MCA/IElCX0RSWSA6IElCX1RZUEUpO1xuXHRicmVhaztcbiAgICAgIGNhc2UgSUJfU1RPUkVEOlxuXHRpZiAobiA9PSAwKXtcblx0ICB0aGlzLmJpdGI9YjsgdGhpcy5iaXRrPWs7IFxuXHQgIHouYXZhaWxfaW49bjt6LnRvdGFsX2luKz1wLXoubmV4dF9pbl9pbmRleDt6Lm5leHRfaW5faW5kZXg9cDtcblx0ICB3cml0ZT1xO1xuXHQgIHJldHVybiB0aGlzLmluZmxhdGVfZmx1c2goeixyKTtcblx0fVxuXG5cdGlmKG09PTApe1xuXHQgIGlmKHE9PWVuZCYmcmVhZCE9MCl7XG5cdCAgICBxPTA7IG09KHE8dGhpcy5yZWFkID8gdGhpcy5yZWFkLXEtMSA6IHRoaXMuZW5kLXEpO1xuXHQgIH1cblx0ICBpZihtPT0wKXtcblx0ICAgIHRoaXMud3JpdGU9cTsgXG5cdCAgICByPXRoaXMuaW5mbGF0ZV9mbHVzaCh6LHIpO1xuXHQgICAgcT10aGlzLndyaXRlOyBtID0gKHEgPCB0aGlzLnJlYWQgPyB0aGlzLnJlYWQtcS0xIDogdGhpcy5lbmQtcSk7XG5cdCAgICBpZihxPT10aGlzLmVuZCAmJiB0aGlzLnJlYWQgIT0gMCl7XG5cdCAgICAgIHE9MDsgbSA9IChxIDwgdGhpcy5yZWFkID8gdGhpcy5yZWFkLXEtMSA6IHRoaXMuZW5kLXEpO1xuXHQgICAgfVxuXHQgICAgaWYobT09MCl7XG5cdCAgICAgIHRoaXMuYml0Yj1iOyB0aGlzLmJpdGs9azsgXG5cdCAgICAgIHouYXZhaWxfaW49bjt6LnRvdGFsX2luKz1wLXoubmV4dF9pbl9pbmRleDt6Lm5leHRfaW5faW5kZXg9cDtcblx0ICAgICAgdGhpcy53cml0ZT1xO1xuXHQgICAgICByZXR1cm4gdGhpcy5pbmZsYXRlX2ZsdXNoKHoscik7XG5cdCAgICB9XG5cdCAgfVxuXHR9XG5cdHI9Wl9PSztcblxuXHR0ID0gdGhpcy5sZWZ0O1xuXHRpZih0Pm4pIHQgPSBuO1xuXHRpZih0Pm0pIHQgPSBtO1xuXHRhcnJheUNvcHkoei5uZXh0X2luLCBwLCB0aGlzLndpbmRvdywgcSwgdCk7XG5cdHAgKz0gdDsgIG4gLT0gdDtcblx0cSArPSB0OyAgbSAtPSB0O1xuXHRpZiAoKHRoaXMubGVmdCAtPSB0KSAhPSAwKVxuXHQgIGJyZWFrO1xuXHR0aGlzLm1vZGUgPSAodGhpcy5sYXN0ICE9IDAgPyBJQl9EUlkgOiBJQl9UWVBFKTtcblx0YnJlYWs7XG4gICAgICBjYXNlIElCX1RBQkxFOlxuXG5cdHdoaWxlKGs8KDE0KSl7XG5cdCAgaWYobiE9MCl7XG5cdCAgICByPVpfT0s7XG5cdCAgfVxuXHQgIGVsc2V7XG5cdCAgICB0aGlzLmJpdGI9YjsgdGhpcy5iaXRrPWs7IFxuXHQgICAgei5hdmFpbF9pbj1uO1xuXHQgICAgei50b3RhbF9pbis9cC16Lm5leHRfaW5faW5kZXg7ei5uZXh0X2luX2luZGV4PXA7XG5cdCAgICB0aGlzLndyaXRlPXE7XG5cdCAgICByZXR1cm4gdGhpcy5pbmZsYXRlX2ZsdXNoKHoscik7XG5cdCAgfTtcblx0ICBuLS07XG5cdCAgYnw9KHoubmV4dF9pbltwKytdJjB4ZmYpPDxrO1xuXHQgIGsrPTg7XG5cdH1cblxuXHR0aGlzLnRhYmxlID0gdCA9IChiICYgMHgzZmZmKTtcblx0aWYgKCh0ICYgMHgxZikgPiAyOSB8fCAoKHQgPj4gNSkgJiAweDFmKSA+IDI5KVxuXHQgIHtcblx0ICAgIHRoaXMubW9kZSA9IElCX0JBRDtcblx0ICAgIHoubXNnID0gXCJ0b28gbWFueSBsZW5ndGggb3IgZGlzdGFuY2Ugc3ltYm9sc1wiO1xuXHQgICAgciA9IFpfREFUQV9FUlJPUjtcblxuXHQgICAgdGhpcy5iaXRiPWI7IHRoaXMuYml0az1rOyBcblx0ICAgIHouYXZhaWxfaW49bjt6LnRvdGFsX2luKz1wLXoubmV4dF9pbl9pbmRleDt6Lm5leHRfaW5faW5kZXg9cDtcblx0ICAgIHRoaXMud3JpdGU9cTtcblx0ICAgIHJldHVybiB0aGlzLmluZmxhdGVfZmx1c2goeixyKTtcblx0ICB9XG5cdHQgPSAyNTggKyAodCAmIDB4MWYpICsgKCh0ID4+IDUpICYgMHgxZik7XG5cdGlmKHRoaXMuYmxlbnM9PW51bGwgfHwgdGhpcy5ibGVucy5sZW5ndGg8dCl7XG5cdCAgICB0aGlzLmJsZW5zPW5ldyBJbnQzMkFycmF5KHQpO1xuXHR9XG5cdGVsc2V7XG5cdCAgZm9yKHZhciBpPTA7IGk8dDsgaSsrKXtcbiAgICAgICAgICAgICAgdGhpcy5ibGVuc1tpXT0wO1xuICAgICAgICAgIH1cblx0fVxuXG5cdHtiPj4+PSgxNCk7ay09KDE0KTt9XG5cblx0dGhpcy5pbmRleCA9IDA7XG5cdG1vZGUgPSBJQl9CVFJFRTtcbiAgICAgIGNhc2UgSUJfQlRSRUU6XG5cdHdoaWxlICh0aGlzLmluZGV4IDwgNCArICh0aGlzLnRhYmxlID4+PiAxMCkpe1xuXHQgIHdoaWxlKGs8KDMpKXtcblx0ICAgIGlmKG4hPTApe1xuXHQgICAgICByPVpfT0s7XG5cdCAgICB9XG5cdCAgICBlbHNle1xuXHQgICAgICB0aGlzLmJpdGI9YjsgdGhpcy5iaXRrPWs7IFxuXHQgICAgICB6LmF2YWlsX2luPW47XG5cdCAgICAgIHoudG90YWxfaW4rPXAtei5uZXh0X2luX2luZGV4O3oubmV4dF9pbl9pbmRleD1wO1xuXHQgICAgICB0aGlzLndyaXRlPXE7XG5cdCAgICAgIHJldHVybiB0aGlzLmluZmxhdGVfZmx1c2goeixyKTtcblx0ICAgIH07XG5cdCAgICBuLS07XG5cdCAgICBifD0oei5uZXh0X2luW3ArK10mMHhmZik8PGs7XG5cdCAgICBrKz04O1xuXHQgIH1cblxuXHQgIHRoaXMuYmxlbnNbSU5GQkxPQ0tTX0JPUkRFUlt0aGlzLmluZGV4KytdXSA9IGImNztcblxuXHQgIHtiPj4+PSgzKTtrLT0oMyk7fVxuXHR9XG5cblx0d2hpbGUodGhpcy5pbmRleCA8IDE5KXtcblx0ICB0aGlzLmJsZW5zW0lORkJMT0NLU19CT1JERVJbdGhpcy5pbmRleCsrXV0gPSAwO1xuXHR9XG5cblx0dGhpcy5iYlswXSA9IDc7XG5cdHQgPSB0aGlzLmluZnRyZWUuaW5mbGF0ZV90cmVlc19iaXRzKHRoaXMuYmxlbnMsIHRoaXMuYmIsIHRoaXMudGIsIHRoaXMuaHVmdHMsIHopO1xuXHRpZiAodCAhPSBaX09LKXtcblx0ICByID0gdDtcblx0ICBpZiAociA9PSBaX0RBVEFfRVJST1Ipe1xuXHQgICAgdGhpcy5ibGVucz1udWxsO1xuXHQgICAgdGhpcy5tb2RlID0gSUJfQkFEO1xuXHQgIH1cblxuXHQgIHRoaXMuYml0Yj1iOyB0aGlzLmJpdGs9azsgXG5cdCAgei5hdmFpbF9pbj1uO3oudG90YWxfaW4rPXAtei5uZXh0X2luX2luZGV4O3oubmV4dF9pbl9pbmRleD1wO1xuXHQgIHdyaXRlPXE7XG5cdCAgcmV0dXJuIHRoaXMuaW5mbGF0ZV9mbHVzaCh6LHIpO1xuXHR9XG5cblx0dGhpcy5pbmRleCA9IDA7XG5cdHRoaXMubW9kZSA9IElCX0RUUkVFO1xuICAgICAgY2FzZSBJQl9EVFJFRTpcblx0d2hpbGUgKHRydWUpe1xuXHQgIHQgPSB0aGlzLnRhYmxlO1xuXHQgIGlmKCEodGhpcy5pbmRleCA8IDI1OCArICh0ICYgMHgxZikgKyAoKHQgPj4gNSkgJiAweDFmKSkpe1xuXHQgICAgYnJlYWs7XG5cdCAgfVxuXG5cdCAgdmFyIGg7IC8vaW50W11cblx0ICB2YXIgaSwgaiwgYztcblxuXHQgIHQgPSB0aGlzLmJiWzBdO1xuXG5cdCAgd2hpbGUoazwodCkpe1xuXHQgICAgaWYobiE9MCl7XG5cdCAgICAgIHI9Wl9PSztcblx0ICAgIH1cblx0ICAgIGVsc2V7XG5cdCAgICAgIHRoaXMuYml0Yj1iOyB0aGlzLmJpdGs9azsgXG5cdCAgICAgIHouYXZhaWxfaW49bjtcblx0ICAgICAgei50b3RhbF9pbis9cC16Lm5leHRfaW5faW5kZXg7ei5uZXh0X2luX2luZGV4PXA7XG5cdCAgICAgIHRoaXMud3JpdGU9cTtcblx0ICAgICAgcmV0dXJuIHRoaXMuaW5mbGF0ZV9mbHVzaCh6LHIpO1xuXHQgICAgfTtcblx0ICAgIG4tLTtcblx0ICAgIGJ8PSh6Lm5leHRfaW5bcCsrXSYweGZmKTw8aztcblx0ICAgIGsrPTg7XG5cdCAgfVxuXG4vL1x0ICBpZiAodGhpcy50YlswXT09LTEpe1xuLy8gICAgICAgICAgICBkbG9nKFwibnVsbC4uLlwiKTtcbi8vXHQgIH1cblxuXHQgIHQ9dGhpcy5odWZ0c1sodGhpcy50YlswXSsoYiAmIGluZmxhdGVfbWFza1t0XSkpKjMrMV07XG5cdCAgYz10aGlzLmh1ZnRzWyh0aGlzLnRiWzBdKyhiICYgaW5mbGF0ZV9tYXNrW3RdKSkqMysyXTtcblxuXHQgIGlmIChjIDwgMTYpe1xuXHQgICAgYj4+Pj0odCk7ay09KHQpO1xuXHQgICAgdGhpcy5ibGVuc1t0aGlzLmluZGV4KytdID0gYztcblx0ICB9XG5cdCAgZWxzZSB7IC8vIGMgPT0gMTYuLjE4XG5cdCAgICBpID0gYyA9PSAxOCA/IDcgOiBjIC0gMTQ7XG5cdCAgICBqID0gYyA9PSAxOCA/IDExIDogMztcblxuXHQgICAgd2hpbGUoazwodCtpKSl7XG5cdCAgICAgIGlmKG4hPTApe1xuXHRcdHI9Wl9PSztcblx0ICAgICAgfVxuXHQgICAgICBlbHNle1xuXHRcdHRoaXMuYml0Yj1iOyB0aGlzLmJpdGs9azsgXG5cdFx0ei5hdmFpbF9pbj1uO1xuXHRcdHoudG90YWxfaW4rPXAtei5uZXh0X2luX2luZGV4O3oubmV4dF9pbl9pbmRleD1wO1xuXHRcdHRoaXMud3JpdGU9cTtcblx0XHRyZXR1cm4gdGhpcy5pbmZsYXRlX2ZsdXNoKHoscik7XG5cdCAgICAgIH07XG5cdCAgICAgIG4tLTtcblx0ICAgICAgYnw9KHoubmV4dF9pbltwKytdJjB4ZmYpPDxrO1xuXHQgICAgICBrKz04O1xuXHQgICAgfVxuXG5cdCAgICBiPj4+PSh0KTtrLT0odCk7XG5cblx0ICAgIGogKz0gKGIgJiBpbmZsYXRlX21hc2tbaV0pO1xuXG5cdCAgICBiPj4+PShpKTtrLT0oaSk7XG5cblx0ICAgIGkgPSB0aGlzLmluZGV4O1xuXHQgICAgdCA9IHRoaXMudGFibGU7XG5cdCAgICBpZiAoaSArIGogPiAyNTggKyAodCAmIDB4MWYpICsgKCh0ID4+IDUpICYgMHgxZikgfHxcblx0XHQoYyA9PSAxNiAmJiBpIDwgMSkpe1xuXHQgICAgICB0aGlzLmJsZW5zPW51bGw7XG5cdCAgICAgIHRoaXMubW9kZSA9IElCX0JBRDtcblx0ICAgICAgei5tc2cgPSBcImludmFsaWQgYml0IGxlbmd0aCByZXBlYXRcIjtcblx0ICAgICAgciA9IFpfREFUQV9FUlJPUjtcblxuXHQgICAgICB0aGlzLmJpdGI9YjsgdGhpcy5iaXRrPWs7IFxuXHQgICAgICB6LmF2YWlsX2luPW47ei50b3RhbF9pbis9cC16Lm5leHRfaW5faW5kZXg7ei5uZXh0X2luX2luZGV4PXA7XG5cdCAgICAgIHRoaXMud3JpdGU9cTtcblx0ICAgICAgcmV0dXJuIHRoaXMuaW5mbGF0ZV9mbHVzaCh6LHIpO1xuXHQgICAgfVxuXG5cdCAgICBjID0gYyA9PSAxNiA/IHRoaXMuYmxlbnNbaS0xXSA6IDA7XG5cdCAgICBkb3tcblx0ICAgICAgdGhpcy5ibGVuc1tpKytdID0gYztcblx0ICAgIH1cblx0ICAgIHdoaWxlICgtLWohPTApO1xuXHQgICAgdGhpcy5pbmRleCA9IGk7XG5cdCAgfVxuXHR9XG5cblx0dGhpcy50YlswXT0tMTtcblx0e1xuXHQgICAgdmFyIGJsPW5ldyBJbnQzMkFycmF5KDEpO1xuXHQgICAgdmFyIGJkPW5ldyBJbnQzMkFycmF5KDEpO1xuXHQgICAgdmFyIHRsPW5ldyBJbnQzMkFycmF5KDEpO1xuXHQgICAgdmFyIHRkPW5ldyBJbnQzMkFycmF5KDEpO1xuXHQgICAgYmxbMF0gPSA5OyAgICAgICAgIC8vIG11c3QgYmUgPD0gOSBmb3IgbG9va2FoZWFkIGFzc3VtcHRpb25zXG5cdCAgICBiZFswXSA9IDY7ICAgICAgICAgLy8gbXVzdCBiZSA8PSA5IGZvciBsb29rYWhlYWQgYXNzdW1wdGlvbnNcblxuXHQgICAgdCA9IHRoaXMudGFibGU7XG5cdCAgICB0ID0gdGhpcy5pbmZ0cmVlLmluZmxhdGVfdHJlZXNfZHluYW1pYygyNTcgKyAodCAmIDB4MWYpLCBcblx0XHRcdFx0XHQgICAgICAxICsgKCh0ID4+IDUpICYgMHgxZiksXG5cdFx0XHRcdFx0ICAgICAgdGhpcy5ibGVucywgYmwsIGJkLCB0bCwgdGQsIHRoaXMuaHVmdHMsIHopO1xuXG5cdCAgICBpZiAodCAhPSBaX09LKXtcblx0ICAgICAgICBpZiAodCA9PSBaX0RBVEFfRVJST1Ipe1xuXHQgICAgICAgICAgICB0aGlzLmJsZW5zPW51bGw7XG5cdCAgICAgICAgICAgIHRoaXMubW9kZSA9IEJBRDtcblx0ICAgICAgICB9XG5cdCAgICAgICAgciA9IHQ7XG5cblx0ICAgICAgICB0aGlzLmJpdGI9YjsgdGhpcy5iaXRrPWs7IFxuXHQgICAgICAgIHouYXZhaWxfaW49bjt6LnRvdGFsX2luKz1wLXoubmV4dF9pbl9pbmRleDt6Lm5leHRfaW5faW5kZXg9cDtcblx0ICAgICAgICB0aGlzLndyaXRlPXE7XG5cdCAgICAgICAgcmV0dXJuIHRoaXMuaW5mbGF0ZV9mbHVzaCh6LHIpO1xuXHQgICAgfVxuXHQgICAgdGhpcy5jb2Rlcy5pbml0KGJsWzBdLCBiZFswXSwgdGhpcy5odWZ0cywgdGxbMF0sIHRoaXMuaHVmdHMsIHRkWzBdLCB6KTtcblx0fVxuXHR0aGlzLm1vZGUgPSBJQl9DT0RFUztcbiAgICAgIGNhc2UgSUJfQ09ERVM6XG5cdHRoaXMuYml0Yj1iOyB0aGlzLmJpdGs9aztcblx0ei5hdmFpbF9pbj1uOyB6LnRvdGFsX2luKz1wLXoubmV4dF9pbl9pbmRleDt6Lm5leHRfaW5faW5kZXg9cDtcblx0dGhpcy53cml0ZT1xO1xuXG5cdGlmICgociA9IHRoaXMuY29kZXMucHJvYyh0aGlzLCB6LCByKSkgIT0gWl9TVFJFQU1fRU5EKXtcblx0ICByZXR1cm4gdGhpcy5pbmZsYXRlX2ZsdXNoKHosIHIpO1xuXHR9XG5cdHIgPSBaX09LO1xuXHR0aGlzLmNvZGVzLmZyZWUoeik7XG5cblx0cD16Lm5leHRfaW5faW5kZXg7IG49ei5hdmFpbF9pbjtiPXRoaXMuYml0YjtrPXRoaXMuYml0aztcblx0cT10aGlzLndyaXRlO20gPSAocSA8IHRoaXMucmVhZCA/IHRoaXMucmVhZC1xLTEgOiB0aGlzLmVuZC1xKTtcblxuXHRpZiAodGhpcy5sYXN0PT0wKXtcblx0ICB0aGlzLm1vZGUgPSBJQl9UWVBFO1xuXHQgIGJyZWFrO1xuXHR9XG5cdHRoaXMubW9kZSA9IElCX0RSWTtcbiAgICAgIGNhc2UgSUJfRFJZOlxuXHR0aGlzLndyaXRlPXE7IFxuXHRyID0gdGhpcy5pbmZsYXRlX2ZsdXNoKHosIHIpOyBcblx0cT10aGlzLndyaXRlOyBtID0gKHEgPCB0aGlzLnJlYWQgPyB0aGlzLnJlYWQtcS0xIDogdGhpcy5lbmQtcSk7XG5cdGlmICh0aGlzLnJlYWQgIT0gdGhpcy53cml0ZSl7XG5cdCAgdGhpcy5iaXRiPWI7IHRoaXMuYml0az1rOyBcblx0ICB6LmF2YWlsX2luPW47ei50b3RhbF9pbis9cC16Lm5leHRfaW5faW5kZXg7ei5uZXh0X2luX2luZGV4PXA7XG5cdCAgdGhpcy53cml0ZT1xO1xuXHQgIHJldHVybiB0aGlzLmluZmxhdGVfZmx1c2goeiwgcik7XG5cdH1cblx0bW9kZSA9IERPTkU7XG4gICAgICBjYXNlIElCX0RPTkU6XG5cdHIgPSBaX1NUUkVBTV9FTkQ7XG5cblx0dGhpcy5iaXRiPWI7IHRoaXMuYml0az1rOyBcblx0ei5hdmFpbF9pbj1uO3oudG90YWxfaW4rPXAtei5uZXh0X2luX2luZGV4O3oubmV4dF9pbl9pbmRleD1wO1xuXHR0aGlzLndyaXRlPXE7XG5cdHJldHVybiB0aGlzLmluZmxhdGVfZmx1c2goeiwgcik7XG4gICAgICBjYXNlIElCX0JBRDpcblx0ciA9IFpfREFUQV9FUlJPUjtcblxuXHR0aGlzLmJpdGI9YjsgdGhpcy5iaXRrPWs7IFxuXHR6LmF2YWlsX2luPW47ei50b3RhbF9pbis9cC16Lm5leHRfaW5faW5kZXg7ei5uZXh0X2luX2luZGV4PXA7XG5cdHRoaXMud3JpdGU9cTtcblx0cmV0dXJuIHRoaXMuaW5mbGF0ZV9mbHVzaCh6LCByKTtcblxuICAgICAgZGVmYXVsdDpcblx0ciA9IFpfU1RSRUFNX0VSUk9SO1xuXG5cdHRoaXMuYml0Yj1iOyB0aGlzLmJpdGs9azsgXG5cdHouYXZhaWxfaW49bjt6LnRvdGFsX2luKz1wLXoubmV4dF9pbl9pbmRleDt6Lm5leHRfaW5faW5kZXg9cDtcblx0dGhpcy53cml0ZT1xO1xuXHRyZXR1cm4gdGhpcy5pbmZsYXRlX2ZsdXNoKHosIHIpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG5JbmZCbG9ja3MucHJvdG90eXBlLmZyZWUgPSBmdW5jdGlvbih6KXtcbiAgICB0aGlzLnJlc2V0KHosIG51bGwpO1xuICAgIHRoaXMud2luZG93PW51bGw7XG4gICAgdGhpcy5odWZ0cz1udWxsO1xufVxuXG5JbmZCbG9ja3MucHJvdG90eXBlLnNldF9kaWN0aW9uYXJ5ID0gZnVuY3Rpb24oZCwgc3RhcnQsIG4pe1xuICAgIGFycmF5Q29weShkLCBzdGFydCwgd2luZG93LCAwLCBuKTtcbiAgICB0aGlzLnJlYWQgPSB0aGlzLndyaXRlID0gbjtcbn1cblxuICAvLyBSZXR1cm5zIHRydWUgaWYgaW5mbGF0ZSBpcyBjdXJyZW50bHkgYXQgdGhlIGVuZCBvZiBhIGJsb2NrIGdlbmVyYXRlZFxuICAvLyBieSBaX1NZTkNfRkxVU0ggb3IgWl9GVUxMX0ZMVVNILiBcbkluZkJsb2Nrcy5wcm90b3R5cGUuc3luY19wb2ludCA9IGZ1bmN0aW9uKCl7XG4gICAgcmV0dXJuIHRoaXMubW9kZSA9PSBJQl9MRU5TO1xufVxuXG4gIC8vIGNvcHkgYXMgbXVjaCBhcyBwb3NzaWJsZSBmcm9tIHRoZSBzbGlkaW5nIHdpbmRvdyB0byB0aGUgb3V0cHV0IGFyZWFcbkluZkJsb2Nrcy5wcm90b3R5cGUuaW5mbGF0ZV9mbHVzaCA9IGZ1bmN0aW9uKHosIHIpe1xuICAgIHZhciBuO1xuICAgIHZhciBwO1xuICAgIHZhciBxO1xuXG4gICAgLy8gbG9jYWwgY29waWVzIG9mIHNvdXJjZSBhbmQgZGVzdGluYXRpb24gcG9pbnRlcnNcbiAgICBwID0gei5uZXh0X291dF9pbmRleDtcbiAgICBxID0gdGhpcy5yZWFkO1xuXG4gICAgLy8gY29tcHV0ZSBudW1iZXIgb2YgYnl0ZXMgdG8gY29weSBhcyBmYXIgYXMgZW5kIG9mIHdpbmRvd1xuICAgIG4gPSAoKHEgPD0gdGhpcy53cml0ZSA/IHRoaXMud3JpdGUgOiB0aGlzLmVuZCkgLSBxKTtcbiAgICBpZiAobiA+IHouYXZhaWxfb3V0KSBuID0gei5hdmFpbF9vdXQ7XG4gICAgaWYgKG4hPTAgJiYgciA9PSBaX0JVRl9FUlJPUikgciA9IFpfT0s7XG5cbiAgICAvLyB1cGRhdGUgY291bnRlcnNcbiAgICB6LmF2YWlsX291dCAtPSBuO1xuICAgIHoudG90YWxfb3V0ICs9IG47XG5cbiAgICAvLyB1cGRhdGUgY2hlY2sgaW5mb3JtYXRpb25cbiAgICBpZih0aGlzLmNoZWNrZm4gIT0gbnVsbClcbiAgICAgIHouYWRsZXI9dGhpcy5jaGVjaz16Ll9hZGxlci5hZGxlcjMyKHRoaXMuY2hlY2ssIHRoaXMud2luZG93LCBxLCBuKTtcblxuICAgIC8vIGNvcHkgYXMgZmFyIGFzIGVuZCBvZiB3aW5kb3dcbiAgICBhcnJheUNvcHkodGhpcy53aW5kb3csIHEsIHoubmV4dF9vdXQsIHAsIG4pO1xuICAgIHAgKz0gbjtcbiAgICBxICs9IG47XG5cbiAgICAvLyBzZWUgaWYgbW9yZSB0byBjb3B5IGF0IGJlZ2lubmluZyBvZiB3aW5kb3dcbiAgICBpZiAocSA9PSB0aGlzLmVuZCl7XG4gICAgICAvLyB3cmFwIHBvaW50ZXJzXG4gICAgICBxID0gMDtcbiAgICAgIGlmICh0aGlzLndyaXRlID09IHRoaXMuZW5kKVxuICAgICAgICB0aGlzLndyaXRlID0gMDtcblxuICAgICAgLy8gY29tcHV0ZSBieXRlcyB0byBjb3B5XG4gICAgICBuID0gdGhpcy53cml0ZSAtIHE7XG4gICAgICBpZiAobiA+IHouYXZhaWxfb3V0KSBuID0gei5hdmFpbF9vdXQ7XG4gICAgICBpZiAobiE9MCAmJiByID09IFpfQlVGX0VSUk9SKSByID0gWl9PSztcblxuICAgICAgLy8gdXBkYXRlIGNvdW50ZXJzXG4gICAgICB6LmF2YWlsX291dCAtPSBuO1xuICAgICAgei50b3RhbF9vdXQgKz0gbjtcblxuICAgICAgLy8gdXBkYXRlIGNoZWNrIGluZm9ybWF0aW9uXG4gICAgICBpZih0aGlzLmNoZWNrZm4gIT0gbnVsbClcblx0ei5hZGxlcj10aGlzLmNoZWNrPXouX2FkbGVyLmFkbGVyMzIodGhpcy5jaGVjaywgdGhpcy53aW5kb3csIHEsIG4pO1xuXG4gICAgICAvLyBjb3B5XG4gICAgICBhcnJheUNvcHkodGhpcy53aW5kb3csIHEsIHoubmV4dF9vdXQsIHAsIG4pO1xuICAgICAgcCArPSBuO1xuICAgICAgcSArPSBuO1xuICAgIH1cblxuICAgIC8vIHVwZGF0ZSBwb2ludGVyc1xuICAgIHoubmV4dF9vdXRfaW5kZXggPSBwO1xuICAgIHRoaXMucmVhZCA9IHE7XG5cbiAgICAvLyBkb25lXG4gICAgcmV0dXJuIHI7XG4gIH1cblxuLy9cbi8vIEluZkNvZGVzLmphdmFcbi8vXG5cbnZhciBJQ19TVEFSVD0wOyAgLy8geDogc2V0IHVwIGZvciBMRU5cbnZhciBJQ19MRU49MTsgICAgLy8gaTogZ2V0IGxlbmd0aC9saXRlcmFsL2VvYiBuZXh0XG52YXIgSUNfTEVORVhUPTI7IC8vIGk6IGdldHRpbmcgbGVuZ3RoIGV4dHJhIChoYXZlIGJhc2UpXG52YXIgSUNfRElTVD0zOyAgIC8vIGk6IGdldCBkaXN0YW5jZSBuZXh0XG52YXIgSUNfRElTVEVYVD00Oy8vIGk6IGdldHRpbmcgZGlzdGFuY2UgZXh0cmFcbnZhciBJQ19DT1BZPTU7ICAgLy8gbzogY29weWluZyBieXRlcyBpbiB3aW5kb3csIHdhaXRpbmcgZm9yIHNwYWNlXG52YXIgSUNfTElUPTY7ICAgIC8vIG86IGdvdCBsaXRlcmFsLCB3YWl0aW5nIGZvciBvdXRwdXQgc3BhY2VcbnZhciBJQ19XQVNIPTc7ICAgLy8gbzogZ290IGVvYiwgcG9zc2libHkgc3RpbGwgb3V0cHV0IHdhaXRpbmdcbnZhciBJQ19FTkQ9ODsgICAgLy8geDogZ290IGVvYiBhbmQgYWxsIGRhdGEgZmx1c2hlZFxudmFyIElDX0JBRENPREU9OTsvLyB4OiBnb3QgZXJyb3JcblxuZnVuY3Rpb24gSW5mQ29kZXMoKSB7XG59XG5cbkluZkNvZGVzLnByb3RvdHlwZS5pbml0ID0gZnVuY3Rpb24oYmwsIGJkLCB0bCwgdGxfaW5kZXgsIHRkLCB0ZF9pbmRleCwgeikge1xuICAgIHRoaXMubW9kZT1JQ19TVEFSVDtcbiAgICB0aGlzLmxiaXRzPWJsO1xuICAgIHRoaXMuZGJpdHM9YmQ7XG4gICAgdGhpcy5sdHJlZT10bDtcbiAgICB0aGlzLmx0cmVlX2luZGV4PXRsX2luZGV4O1xuICAgIHRoaXMuZHRyZWUgPSB0ZDtcbiAgICB0aGlzLmR0cmVlX2luZGV4PXRkX2luZGV4O1xuICAgIHRoaXMudHJlZT1udWxsO1xufVxuXG5JbmZDb2Rlcy5wcm90b3R5cGUucHJvYyA9IGZ1bmN0aW9uKHMsIHosIHIpeyBcbiAgICB2YXIgajsgICAgICAgICAgICAgIC8vIHRlbXBvcmFyeSBzdG9yYWdlXG4gICAgdmFyIHQ7ICAgICAgICAgICAgICAvLyB0ZW1wb3JhcnkgcG9pbnRlciAoaW50W10pXG4gICAgdmFyIHRpbmRleDsgICAgICAgICAvLyB0ZW1wb3JhcnkgcG9pbnRlclxuICAgIHZhciBlOyAgICAgICAgICAgICAgLy8gZXh0cmEgYml0cyBvciBvcGVyYXRpb25cbiAgICB2YXIgYj0wOyAgICAgICAgICAgIC8vIGJpdCBidWZmZXJcbiAgICB2YXIgaz0wOyAgICAgICAgICAgIC8vIGJpdHMgaW4gYml0IGJ1ZmZlclxuICAgIHZhciBwPTA7ICAgICAgICAgICAgLy8gaW5wdXQgZGF0YSBwb2ludGVyXG4gICAgdmFyIG47ICAgICAgICAgICAgICAvLyBieXRlcyBhdmFpbGFibGUgdGhlcmVcbiAgICB2YXIgcTsgICAgICAgICAgICAgIC8vIG91dHB1dCB3aW5kb3cgd3JpdGUgcG9pbnRlclxuICAgIHZhciBtOyAgICAgICAgICAgICAgLy8gYnl0ZXMgdG8gZW5kIG9mIHdpbmRvdyBvciByZWFkIHBvaW50ZXJcbiAgICB2YXIgZjsgICAgICAgICAgICAgIC8vIHBvaW50ZXIgdG8gY29weSBzdHJpbmdzIGZyb21cblxuICAgIC8vIGNvcHkgaW5wdXQvb3V0cHV0IGluZm9ybWF0aW9uIHRvIGxvY2FscyAoVVBEQVRFIG1hY3JvIHJlc3RvcmVzKVxuICAgIHA9ei5uZXh0X2luX2luZGV4O249ei5hdmFpbF9pbjtiPXMuYml0YjtrPXMuYml0aztcbiAgICBxPXMud3JpdGU7bT1xPHMucmVhZD9zLnJlYWQtcS0xOnMuZW5kLXE7XG5cbiAgICAvLyBwcm9jZXNzIGlucHV0IGFuZCBvdXRwdXQgYmFzZWQgb24gY3VycmVudCBzdGF0ZVxuICAgIHdoaWxlICh0cnVlKXtcbiAgICAgIHN3aXRjaCAodGhpcy5tb2RlKXtcblx0Ly8gd2FpdGluZyBmb3IgXCJpOlwiPWlucHV0LCBcIm86XCI9b3V0cHV0LCBcIng6XCI9bm90aGluZ1xuICAgICAgY2FzZSBJQ19TVEFSVDogICAgICAgICAvLyB4OiBzZXQgdXAgZm9yIExFTlxuXHRpZiAobSA+PSAyNTggJiYgbiA+PSAxMCl7XG5cblx0ICBzLmJpdGI9YjtzLmJpdGs9aztcblx0ICB6LmF2YWlsX2luPW47ei50b3RhbF9pbis9cC16Lm5leHRfaW5faW5kZXg7ei5uZXh0X2luX2luZGV4PXA7XG5cdCAgcy53cml0ZT1xO1xuXHQgIHIgPSB0aGlzLmluZmxhdGVfZmFzdCh0aGlzLmxiaXRzLCB0aGlzLmRiaXRzLCBcblx0XHRcdCAgIHRoaXMubHRyZWUsIHRoaXMubHRyZWVfaW5kZXgsIFxuXHRcdFx0ICAgdGhpcy5kdHJlZSwgdGhpcy5kdHJlZV9pbmRleCxcblx0XHRcdCAgIHMsIHopO1xuXG5cdCAgcD16Lm5leHRfaW5faW5kZXg7bj16LmF2YWlsX2luO2I9cy5iaXRiO2s9cy5iaXRrO1xuXHQgIHE9cy53cml0ZTttPXE8cy5yZWFkP3MucmVhZC1xLTE6cy5lbmQtcTtcblxuXHQgIGlmIChyICE9IFpfT0spe1xuXHQgICAgdGhpcy5tb2RlID0gciA9PSBaX1NUUkVBTV9FTkQgPyBJQ19XQVNIIDogSUNfQkFEQ09ERTtcblx0ICAgIGJyZWFrO1xuXHQgIH1cblx0fVxuXHR0aGlzLm5lZWQgPSB0aGlzLmxiaXRzO1xuXHR0aGlzLnRyZWUgPSB0aGlzLmx0cmVlO1xuXHR0aGlzLnRyZWVfaW5kZXg9dGhpcy5sdHJlZV9pbmRleDtcblxuXHR0aGlzLm1vZGUgPSBJQ19MRU47XG4gICAgICBjYXNlIElDX0xFTjogICAgICAgICAgIC8vIGk6IGdldCBsZW5ndGgvbGl0ZXJhbC9lb2IgbmV4dFxuXHRqID0gdGhpcy5uZWVkO1xuXG5cdHdoaWxlKGs8KGopKXtcblx0ICBpZihuIT0wKXI9Wl9PSztcblx0ICBlbHNle1xuXG5cdCAgICBzLmJpdGI9YjtzLmJpdGs9aztcblx0ICAgIHouYXZhaWxfaW49bjt6LnRvdGFsX2luKz1wLXoubmV4dF9pbl9pbmRleDt6Lm5leHRfaW5faW5kZXg9cDtcblx0ICAgIHMud3JpdGU9cTtcblx0ICAgIHJldHVybiBzLmluZmxhdGVfZmx1c2goeixyKTtcblx0ICB9XG5cdCAgbi0tO1xuXHQgIGJ8PSh6Lm5leHRfaW5bcCsrXSYweGZmKTw8aztcblx0ICBrKz04O1xuXHR9XG5cblx0dGluZGV4PSh0aGlzLnRyZWVfaW5kZXgrKGImaW5mbGF0ZV9tYXNrW2pdKSkqMztcblxuXHRiPj4+PSh0aGlzLnRyZWVbdGluZGV4KzFdKTtcblx0ay09KHRoaXMudHJlZVt0aW5kZXgrMV0pO1xuXG5cdGU9dGhpcy50cmVlW3RpbmRleF07XG5cblx0aWYoZSA9PSAwKXsgICAgICAgICAgICAgICAvLyBsaXRlcmFsXG5cdCAgdGhpcy5saXQgPSB0aGlzLnRyZWVbdGluZGV4KzJdO1xuXHQgIHRoaXMubW9kZSA9IElDX0xJVDtcblx0ICBicmVhaztcblx0fVxuXHRpZigoZSAmIDE2KSE9MCApeyAgICAgICAgICAvLyBsZW5ndGhcblx0ICB0aGlzLmdldCA9IGUgJiAxNTtcblx0ICB0aGlzLmxlbiA9IHRoaXMudHJlZVt0aW5kZXgrMl07XG5cdCAgdGhpcy5tb2RlID0gSUNfTEVORVhUO1xuXHQgIGJyZWFrO1xuXHR9XG5cdGlmICgoZSAmIDY0KSA9PSAwKXsgICAgICAgIC8vIG5leHQgdGFibGVcblx0ICB0aGlzLm5lZWQgPSBlO1xuXHQgIHRoaXMudHJlZV9pbmRleCA9IHRpbmRleC8zICsgdGhpcy50cmVlW3RpbmRleCsyXTtcblx0ICBicmVhaztcblx0fVxuXHRpZiAoKGUgJiAzMikhPTApeyAgICAgICAgICAgICAgIC8vIGVuZCBvZiBibG9ja1xuXHQgIHRoaXMubW9kZSA9IElDX1dBU0g7XG5cdCAgYnJlYWs7XG5cdH1cblx0dGhpcy5tb2RlID0gSUNfQkFEQ09ERTsgICAgICAgIC8vIGludmFsaWQgY29kZVxuXHR6Lm1zZyA9IFwiaW52YWxpZCBsaXRlcmFsL2xlbmd0aCBjb2RlXCI7XG5cdHIgPSBaX0RBVEFfRVJST1I7XG5cblx0cy5iaXRiPWI7cy5iaXRrPWs7XG5cdHouYXZhaWxfaW49bjt6LnRvdGFsX2luKz1wLXoubmV4dF9pbl9pbmRleDt6Lm5leHRfaW5faW5kZXg9cDtcblx0cy53cml0ZT1xO1xuXHRyZXR1cm4gcy5pbmZsYXRlX2ZsdXNoKHoscik7XG5cbiAgICAgIGNhc2UgSUNfTEVORVhUOiAgICAgICAgLy8gaTogZ2V0dGluZyBsZW5ndGggZXh0cmEgKGhhdmUgYmFzZSlcblx0aiA9IHRoaXMuZ2V0O1xuXG5cdHdoaWxlKGs8KGopKXtcblx0ICBpZihuIT0wKXI9Wl9PSztcblx0ICBlbHNle1xuXG5cdCAgICBzLmJpdGI9YjtzLmJpdGs9aztcblx0ICAgIHouYXZhaWxfaW49bjt6LnRvdGFsX2luKz1wLXoubmV4dF9pbl9pbmRleDt6Lm5leHRfaW5faW5kZXg9cDtcblx0ICAgIHMud3JpdGU9cTtcblx0ICAgIHJldHVybiBzLmluZmxhdGVfZmx1c2goeixyKTtcblx0ICB9XG5cdCAgbi0tOyBifD0oei5uZXh0X2luW3ArK10mMHhmZik8PGs7XG5cdCAgays9ODtcblx0fVxuXG5cdHRoaXMubGVuICs9IChiICYgaW5mbGF0ZV9tYXNrW2pdKTtcblxuXHRiPj49ajtcblx0ay09ajtcblxuXHR0aGlzLm5lZWQgPSB0aGlzLmRiaXRzO1xuXHR0aGlzLnRyZWUgPSB0aGlzLmR0cmVlO1xuXHR0aGlzLnRyZWVfaW5kZXggPSB0aGlzLmR0cmVlX2luZGV4O1xuXHR0aGlzLm1vZGUgPSBJQ19ESVNUO1xuICAgICAgY2FzZSBJQ19ESVNUOiAgICAgICAgICAvLyBpOiBnZXQgZGlzdGFuY2UgbmV4dFxuXHRqID0gdGhpcy5uZWVkO1xuXG5cdHdoaWxlKGs8KGopKXtcblx0ICBpZihuIT0wKXI9Wl9PSztcblx0ICBlbHNle1xuXG5cdCAgICBzLmJpdGI9YjtzLmJpdGs9aztcblx0ICAgIHouYXZhaWxfaW49bjt6LnRvdGFsX2luKz1wLXoubmV4dF9pbl9pbmRleDt6Lm5leHRfaW5faW5kZXg9cDtcblx0ICAgIHMud3JpdGU9cTtcblx0ICAgIHJldHVybiBzLmluZmxhdGVfZmx1c2goeixyKTtcblx0ICB9XG5cdCAgbi0tOyBifD0oei5uZXh0X2luW3ArK10mMHhmZik8PGs7XG5cdCAgays9ODtcblx0fVxuXG5cdHRpbmRleD0odGhpcy50cmVlX2luZGV4KyhiICYgaW5mbGF0ZV9tYXNrW2pdKSkqMztcblxuXHRiPj49dGhpcy50cmVlW3RpbmRleCsxXTtcblx0ay09dGhpcy50cmVlW3RpbmRleCsxXTtcblxuXHRlID0gKHRoaXMudHJlZVt0aW5kZXhdKTtcblx0aWYoKGUgJiAxNikhPTApeyAgICAgICAgICAgICAgIC8vIGRpc3RhbmNlXG5cdCAgdGhpcy5nZXQgPSBlICYgMTU7XG5cdCAgdGhpcy5kaXN0ID0gdGhpcy50cmVlW3RpbmRleCsyXTtcblx0ICB0aGlzLm1vZGUgPSBJQ19ESVNURVhUO1xuXHQgIGJyZWFrO1xuXHR9XG5cdGlmICgoZSAmIDY0KSA9PSAwKXsgICAgICAgIC8vIG5leHQgdGFibGVcblx0ICB0aGlzLm5lZWQgPSBlO1xuXHQgIHRoaXMudHJlZV9pbmRleCA9IHRpbmRleC8zICsgdGhpcy50cmVlW3RpbmRleCsyXTtcblx0ICBicmVhaztcblx0fVxuXHR0aGlzLm1vZGUgPSBJQ19CQURDT0RFOyAgICAgICAgLy8gaW52YWxpZCBjb2RlXG5cdHoubXNnID0gXCJpbnZhbGlkIGRpc3RhbmNlIGNvZGVcIjtcblx0ciA9IFpfREFUQV9FUlJPUjtcblxuXHRzLmJpdGI9YjtzLmJpdGs9aztcblx0ei5hdmFpbF9pbj1uO3oudG90YWxfaW4rPXAtei5uZXh0X2luX2luZGV4O3oubmV4dF9pbl9pbmRleD1wO1xuXHRzLndyaXRlPXE7XG5cdHJldHVybiBzLmluZmxhdGVfZmx1c2goeixyKTtcblxuICAgICAgY2FzZSBJQ19ESVNURVhUOiAgICAgICAvLyBpOiBnZXR0aW5nIGRpc3RhbmNlIGV4dHJhXG5cdGogPSB0aGlzLmdldDtcblxuXHR3aGlsZShrPChqKSl7XG5cdCAgaWYobiE9MClyPVpfT0s7XG5cdCAgZWxzZXtcblxuXHQgICAgcy5iaXRiPWI7cy5iaXRrPWs7XG5cdCAgICB6LmF2YWlsX2luPW47ei50b3RhbF9pbis9cC16Lm5leHRfaW5faW5kZXg7ei5uZXh0X2luX2luZGV4PXA7XG5cdCAgICBzLndyaXRlPXE7XG5cdCAgICByZXR1cm4gcy5pbmZsYXRlX2ZsdXNoKHoscik7XG5cdCAgfVxuXHQgIG4tLTsgYnw9KHoubmV4dF9pbltwKytdJjB4ZmYpPDxrO1xuXHQgIGsrPTg7XG5cdH1cblxuXHR0aGlzLmRpc3QgKz0gKGIgJiBpbmZsYXRlX21hc2tbal0pO1xuXG5cdGI+Pj1qO1xuXHRrLT1qO1xuXG5cdHRoaXMubW9kZSA9IElDX0NPUFk7XG4gICAgICBjYXNlIElDX0NPUFk6ICAgICAgICAgIC8vIG86IGNvcHlpbmcgYnl0ZXMgaW4gd2luZG93LCB3YWl0aW5nIGZvciBzcGFjZVxuICAgICAgICBmID0gcSAtIHRoaXMuZGlzdDtcbiAgICAgICAgd2hpbGUoZiA8IDApeyAgICAgLy8gbW9kdWxvIHdpbmRvdyBzaXplLVwid2hpbGVcIiBpbnN0ZWFkXG4gICAgICAgICAgZiArPSBzLmVuZDsgICAgIC8vIG9mIFwiaWZcIiBoYW5kbGVzIGludmFsaWQgZGlzdGFuY2VzXG5cdH1cblx0d2hpbGUgKHRoaXMubGVuIT0wKXtcblxuXHQgIGlmKG09PTApe1xuXHQgICAgaWYocT09cy5lbmQmJnMucmVhZCE9MCl7cT0wO209cTxzLnJlYWQ/cy5yZWFkLXEtMTpzLmVuZC1xO31cblx0ICAgIGlmKG09PTApe1xuXHQgICAgICBzLndyaXRlPXE7IHI9cy5pbmZsYXRlX2ZsdXNoKHoscik7XG5cdCAgICAgIHE9cy53cml0ZTttPXE8cy5yZWFkP3MucmVhZC1xLTE6cy5lbmQtcTtcblxuXHQgICAgICBpZihxPT1zLmVuZCYmcy5yZWFkIT0wKXtxPTA7bT1xPHMucmVhZD9zLnJlYWQtcS0xOnMuZW5kLXE7fVxuXG5cdCAgICAgIGlmKG09PTApe1xuXHRcdHMuYml0Yj1iO3MuYml0az1rO1xuXHRcdHouYXZhaWxfaW49bjt6LnRvdGFsX2luKz1wLXoubmV4dF9pbl9pbmRleDt6Lm5leHRfaW5faW5kZXg9cDtcblx0XHRzLndyaXRlPXE7XG5cdFx0cmV0dXJuIHMuaW5mbGF0ZV9mbHVzaCh6LHIpO1xuXHQgICAgICB9ICBcblx0ICAgIH1cblx0ICB9XG5cblx0ICBzLndpbmRvd1txKytdPXMud2luZG93W2YrK107IG0tLTtcblxuXHQgIGlmIChmID09IHMuZW5kKVxuICAgICAgICAgICAgZiA9IDA7XG5cdCAgdGhpcy5sZW4tLTtcblx0fVxuXHR0aGlzLm1vZGUgPSBJQ19TVEFSVDtcblx0YnJlYWs7XG4gICAgICBjYXNlIElDX0xJVDogICAgICAgICAgIC8vIG86IGdvdCBsaXRlcmFsLCB3YWl0aW5nIGZvciBvdXRwdXQgc3BhY2Vcblx0aWYobT09MCl7XG5cdCAgaWYocT09cy5lbmQmJnMucmVhZCE9MCl7cT0wO209cTxzLnJlYWQ/cy5yZWFkLXEtMTpzLmVuZC1xO31cblx0ICBpZihtPT0wKXtcblx0ICAgIHMud3JpdGU9cTsgcj1zLmluZmxhdGVfZmx1c2goeixyKTtcblx0ICAgIHE9cy53cml0ZTttPXE8cy5yZWFkP3MucmVhZC1xLTE6cy5lbmQtcTtcblxuXHQgICAgaWYocT09cy5lbmQmJnMucmVhZCE9MCl7cT0wO209cTxzLnJlYWQ/cy5yZWFkLXEtMTpzLmVuZC1xO31cblx0ICAgIGlmKG09PTApe1xuXHQgICAgICBzLmJpdGI9YjtzLmJpdGs9aztcblx0ICAgICAgei5hdmFpbF9pbj1uO3oudG90YWxfaW4rPXAtei5uZXh0X2luX2luZGV4O3oubmV4dF9pbl9pbmRleD1wO1xuXHQgICAgICBzLndyaXRlPXE7XG5cdCAgICAgIHJldHVybiBzLmluZmxhdGVfZmx1c2goeixyKTtcblx0ICAgIH1cblx0ICB9XG5cdH1cblx0cj1aX09LO1xuXG5cdHMud2luZG93W3ErK109dGhpcy5saXQ7IG0tLTtcblxuXHR0aGlzLm1vZGUgPSBJQ19TVEFSVDtcblx0YnJlYWs7XG4gICAgICBjYXNlIElDX1dBU0g6ICAgICAgICAgICAvLyBvOiBnb3QgZW9iLCBwb3NzaWJseSBtb3JlIG91dHB1dFxuXHRpZiAoayA+IDcpeyAgICAgICAgLy8gcmV0dXJuIHVudXNlZCBieXRlLCBpZiBhbnlcblx0ICBrIC09IDg7XG5cdCAgbisrO1xuXHQgIHAtLTsgICAgICAgICAgICAgLy8gY2FuIGFsd2F5cyByZXR1cm4gb25lXG5cdH1cblxuXHRzLndyaXRlPXE7IHI9cy5pbmZsYXRlX2ZsdXNoKHoscik7XG5cdHE9cy53cml0ZTttPXE8cy5yZWFkP3MucmVhZC1xLTE6cy5lbmQtcTtcblxuXHRpZiAocy5yZWFkICE9IHMud3JpdGUpe1xuXHQgIHMuYml0Yj1iO3MuYml0az1rO1xuXHQgIHouYXZhaWxfaW49bjt6LnRvdGFsX2luKz1wLXoubmV4dF9pbl9pbmRleDt6Lm5leHRfaW5faW5kZXg9cDtcblx0ICBzLndyaXRlPXE7XG5cdCAgcmV0dXJuIHMuaW5mbGF0ZV9mbHVzaCh6LHIpO1xuXHR9XG5cdHRoaXMubW9kZSA9IElDX0VORDtcbiAgICAgIGNhc2UgSUNfRU5EOlxuXHRyID0gWl9TVFJFQU1fRU5EO1xuXHRzLmJpdGI9YjtzLmJpdGs9aztcblx0ei5hdmFpbF9pbj1uO3oudG90YWxfaW4rPXAtei5uZXh0X2luX2luZGV4O3oubmV4dF9pbl9pbmRleD1wO1xuXHRzLndyaXRlPXE7XG5cdHJldHVybiBzLmluZmxhdGVfZmx1c2goeixyKTtcblxuICAgICAgY2FzZSBJQ19CQURDT0RFOiAgICAgICAvLyB4OiBnb3QgZXJyb3JcblxuXHRyID0gWl9EQVRBX0VSUk9SO1xuXG5cdHMuYml0Yj1iO3MuYml0az1rO1xuXHR6LmF2YWlsX2luPW47ei50b3RhbF9pbis9cC16Lm5leHRfaW5faW5kZXg7ei5uZXh0X2luX2luZGV4PXA7XG5cdHMud3JpdGU9cTtcblx0cmV0dXJuIHMuaW5mbGF0ZV9mbHVzaCh6LHIpO1xuXG4gICAgICBkZWZhdWx0OlxuXHRyID0gWl9TVFJFQU1fRVJST1I7XG5cblx0cy5iaXRiPWI7cy5iaXRrPWs7XG5cdHouYXZhaWxfaW49bjt6LnRvdGFsX2luKz1wLXoubmV4dF9pbl9pbmRleDt6Lm5leHRfaW5faW5kZXg9cDtcblx0cy53cml0ZT1xO1xuXHRyZXR1cm4gcy5pbmZsYXRlX2ZsdXNoKHoscik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbkluZkNvZGVzLnByb3RvdHlwZS5mcmVlID0gZnVuY3Rpb24oeil7XG4gICAgLy8gIFpGUkVFKHosIGMpO1xufVxuXG4gIC8vIENhbGxlZCB3aXRoIG51bWJlciBvZiBieXRlcyBsZWZ0IHRvIHdyaXRlIGluIHdpbmRvdyBhdCBsZWFzdCAyNThcbiAgLy8gKHRoZSBtYXhpbXVtIHN0cmluZyBsZW5ndGgpIGFuZCBudW1iZXIgb2YgaW5wdXQgYnl0ZXMgYXZhaWxhYmxlXG4gIC8vIGF0IGxlYXN0IHRlbi4gIFRoZSB0ZW4gYnl0ZXMgYXJlIHNpeCBieXRlcyBmb3IgdGhlIGxvbmdlc3QgbGVuZ3RoL1xuICAvLyBkaXN0YW5jZSBwYWlyIHBsdXMgZm91ciBieXRlcyBmb3Igb3ZlcmxvYWRpbmcgdGhlIGJpdCBidWZmZXIuXG5cbkluZkNvZGVzLnByb3RvdHlwZS5pbmZsYXRlX2Zhc3QgPSBmdW5jdGlvbihibCwgYmQsIHRsLCB0bF9pbmRleCwgdGQsIHRkX2luZGV4LCBzLCB6KSB7XG4gICAgdmFyIHQ7ICAgICAgICAgICAgICAgIC8vIHRlbXBvcmFyeSBwb2ludGVyXG4gICAgdmFyICAgdHA7ICAgICAgICAgICAgIC8vIHRlbXBvcmFyeSBwb2ludGVyIChpbnRbXSlcbiAgICB2YXIgdHBfaW5kZXg7ICAgICAgICAgLy8gdGVtcG9yYXJ5IHBvaW50ZXJcbiAgICB2YXIgZTsgICAgICAgICAgICAgICAgLy8gZXh0cmEgYml0cyBvciBvcGVyYXRpb25cbiAgICB2YXIgYjsgICAgICAgICAgICAgICAgLy8gYml0IGJ1ZmZlclxuICAgIHZhciBrOyAgICAgICAgICAgICAgICAvLyBiaXRzIGluIGJpdCBidWZmZXJcbiAgICB2YXIgcDsgICAgICAgICAgICAgICAgLy8gaW5wdXQgZGF0YSBwb2ludGVyXG4gICAgdmFyIG47ICAgICAgICAgICAgICAgIC8vIGJ5dGVzIGF2YWlsYWJsZSB0aGVyZVxuICAgIHZhciBxOyAgICAgICAgICAgICAgICAvLyBvdXRwdXQgd2luZG93IHdyaXRlIHBvaW50ZXJcbiAgICB2YXIgbTsgICAgICAgICAgICAgICAgLy8gYnl0ZXMgdG8gZW5kIG9mIHdpbmRvdyBvciByZWFkIHBvaW50ZXJcbiAgICB2YXIgbWw7ICAgICAgICAgICAgICAgLy8gbWFzayBmb3IgbGl0ZXJhbC9sZW5ndGggdHJlZVxuICAgIHZhciBtZDsgICAgICAgICAgICAgICAvLyBtYXNrIGZvciBkaXN0YW5jZSB0cmVlXG4gICAgdmFyIGM7ICAgICAgICAgICAgICAgIC8vIGJ5dGVzIHRvIGNvcHlcbiAgICB2YXIgZDsgICAgICAgICAgICAgICAgLy8gZGlzdGFuY2UgYmFjayB0byBjb3B5IGZyb21cbiAgICB2YXIgcjsgICAgICAgICAgICAgICAgLy8gY29weSBzb3VyY2UgcG9pbnRlclxuXG4gICAgdmFyIHRwX2luZGV4X3RfMzsgICAgIC8vICh0cF9pbmRleCt0KSozXG5cbiAgICAvLyBsb2FkIGlucHV0LCBvdXRwdXQsIGJpdCB2YWx1ZXNcbiAgICBwPXoubmV4dF9pbl9pbmRleDtuPXouYXZhaWxfaW47Yj1zLmJpdGI7az1zLmJpdGs7XG4gICAgcT1zLndyaXRlO209cTxzLnJlYWQ/cy5yZWFkLXEtMTpzLmVuZC1xO1xuXG4gICAgLy8gaW5pdGlhbGl6ZSBtYXNrc1xuICAgIG1sID0gaW5mbGF0ZV9tYXNrW2JsXTtcbiAgICBtZCA9IGluZmxhdGVfbWFza1tiZF07XG5cbiAgICAvLyBkbyB1bnRpbCBub3QgZW5vdWdoIGlucHV0IG9yIG91dHB1dCBzcGFjZSBmb3IgZmFzdCBsb29wXG4gICAgZG8geyAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYXNzdW1lIGNhbGxlZCB3aXRoIG0gPj0gMjU4ICYmIG4gPj0gMTBcbiAgICAgIC8vIGdldCBsaXRlcmFsL2xlbmd0aCBjb2RlXG4gICAgICB3aGlsZShrPCgyMCkpeyAgICAgICAgICAgICAgLy8gbWF4IGJpdHMgZm9yIGxpdGVyYWwvbGVuZ3RoIGNvZGVcblx0bi0tO1xuXHRifD0oei5uZXh0X2luW3ArK10mMHhmZik8PGs7ays9ODtcbiAgICAgIH1cblxuICAgICAgdD0gYiZtbDtcbiAgICAgIHRwPXRsOyBcbiAgICAgIHRwX2luZGV4PXRsX2luZGV4O1xuICAgICAgdHBfaW5kZXhfdF8zPSh0cF9pbmRleCt0KSozO1xuICAgICAgaWYgKChlID0gdHBbdHBfaW5kZXhfdF8zXSkgPT0gMCl7XG5cdGI+Pj0odHBbdHBfaW5kZXhfdF8zKzFdKTsgay09KHRwW3RwX2luZGV4X3RfMysxXSk7XG5cblx0cy53aW5kb3dbcSsrXSA9IHRwW3RwX2luZGV4X3RfMysyXTtcblx0bS0tO1xuXHRjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGRvIHtcblxuXHRiPj49KHRwW3RwX2luZGV4X3RfMysxXSk7IGstPSh0cFt0cF9pbmRleF90XzMrMV0pO1xuXG5cdGlmKChlJjE2KSE9MCl7XG5cdCAgZSAmPSAxNTtcblx0ICBjID0gdHBbdHBfaW5kZXhfdF8zKzJdICsgKGIgJiBpbmZsYXRlX21hc2tbZV0pO1xuXG5cdCAgYj4+PWU7IGstPWU7XG5cblx0ICAvLyBkZWNvZGUgZGlzdGFuY2UgYmFzZSBvZiBibG9jayB0byBjb3B5XG5cdCAgd2hpbGUoazwoMTUpKXsgICAgICAgICAgIC8vIG1heCBiaXRzIGZvciBkaXN0YW5jZSBjb2RlXG5cdCAgICBuLS07XG5cdCAgICBifD0oei5uZXh0X2luW3ArK10mMHhmZik8PGs7ays9ODtcblx0ICB9XG5cblx0ICB0PSBiJm1kO1xuXHQgIHRwPXRkO1xuXHQgIHRwX2luZGV4PXRkX2luZGV4O1xuICAgICAgICAgIHRwX2luZGV4X3RfMz0odHBfaW5kZXgrdCkqMztcblx0ICBlID0gdHBbdHBfaW5kZXhfdF8zXTtcblxuXHQgIGRvIHtcblxuXHQgICAgYj4+PSh0cFt0cF9pbmRleF90XzMrMV0pOyBrLT0odHBbdHBfaW5kZXhfdF8zKzFdKTtcblxuXHQgICAgaWYoKGUmMTYpIT0wKXtcblx0ICAgICAgLy8gZ2V0IGV4dHJhIGJpdHMgdG8gYWRkIHRvIGRpc3RhbmNlIGJhc2Vcblx0ICAgICAgZSAmPSAxNTtcblx0ICAgICAgd2hpbGUoazwoZSkpeyAgICAgICAgIC8vIGdldCBleHRyYSBiaXRzICh1cCB0byAxMylcblx0XHRuLS07XG5cdFx0Ynw9KHoubmV4dF9pbltwKytdJjB4ZmYpPDxrO2srPTg7XG5cdCAgICAgIH1cblxuXHQgICAgICBkID0gdHBbdHBfaW5kZXhfdF8zKzJdICsgKGImaW5mbGF0ZV9tYXNrW2VdKTtcblxuXHQgICAgICBiPj49KGUpOyBrLT0oZSk7XG5cblx0ICAgICAgLy8gZG8gdGhlIGNvcHlcblx0ICAgICAgbSAtPSBjO1xuXHQgICAgICBpZiAocSA+PSBkKXsgICAgICAgICAgICAgICAgLy8gb2Zmc2V0IGJlZm9yZSBkZXN0XG5cdFx0Ly8gIGp1c3QgY29weVxuXHRcdHI9cS1kO1xuXHRcdGlmKHEtcj4wICYmIDI+KHEtcikpeyAgICAgICAgICAgXG5cdFx0ICBzLndpbmRvd1txKytdPXMud2luZG93W3IrK107IC8vIG1pbmltdW0gY291bnQgaXMgdGhyZWUsXG5cdFx0ICBzLndpbmRvd1txKytdPXMud2luZG93W3IrK107IC8vIHNvIHVucm9sbCBsb29wIGEgbGl0dGxlXG5cdFx0ICBjLT0yO1xuXHRcdH1cblx0XHRlbHNle1xuXHRcdCAgcy53aW5kb3dbcSsrXT1zLndpbmRvd1tyKytdOyAvLyBtaW5pbXVtIGNvdW50IGlzIHRocmVlLFxuXHRcdCAgcy53aW5kb3dbcSsrXT1zLndpbmRvd1tyKytdOyAvLyBzbyB1bnJvbGwgbG9vcCBhIGxpdHRsZVxuXHRcdCAgYy09Mjtcblx0XHR9XG5cdCAgICAgIH1cblx0ICAgICAgZWxzZXsgICAgICAgICAgICAgICAgICAvLyBlbHNlIG9mZnNldCBhZnRlciBkZXN0aW5hdGlvblxuICAgICAgICAgICAgICAgIHI9cS1kO1xuICAgICAgICAgICAgICAgIGRve1xuICAgICAgICAgICAgICAgICAgcis9cy5lbmQ7ICAgICAgICAgIC8vIGZvcmNlIHBvaW50ZXIgaW4gd2luZG93XG4gICAgICAgICAgICAgICAgfXdoaWxlKHI8MCk7ICAgICAgICAgLy8gY292ZXJzIGludmFsaWQgZGlzdGFuY2VzXG5cdFx0ZT1zLmVuZC1yO1xuXHRcdGlmKGM+ZSl7ICAgICAgICAgICAgIC8vIGlmIHNvdXJjZSBjcm9zc2VzLFxuXHRcdCAgYy09ZTsgICAgICAgICAgICAgIC8vIHdyYXBwZWQgY29weVxuXHRcdCAgaWYocS1yPjAgJiYgZT4ocS1yKSl7ICAgICAgICAgICBcblx0XHQgICAgZG97cy53aW5kb3dbcSsrXSA9IHMud2luZG93W3IrK107fVxuXHRcdCAgICB3aGlsZSgtLWUhPTApO1xuXHRcdCAgfVxuXHRcdCAgZWxzZXtcblx0XHQgICAgYXJyYXlDb3B5KHMud2luZG93LCByLCBzLndpbmRvdywgcSwgZSk7XG5cdFx0ICAgIHErPWU7IHIrPWU7IGU9MDtcblx0XHQgIH1cblx0XHQgIHIgPSAwOyAgICAgICAgICAgICAgICAgIC8vIGNvcHkgcmVzdCBmcm9tIHN0YXJ0IG9mIHdpbmRvd1xuXHRcdH1cblxuXHQgICAgICB9XG5cblx0ICAgICAgLy8gY29weSBhbGwgb3Igd2hhdCdzIGxlZnRcbiAgICAgICAgICAgICAgZG97cy53aW5kb3dbcSsrXSA9IHMud2luZG93W3IrK107fVxuXHRcdHdoaWxlKC0tYyE9MCk7XG5cdCAgICAgIGJyZWFrO1xuXHQgICAgfVxuXHQgICAgZWxzZSBpZigoZSY2NCk9PTApe1xuXHQgICAgICB0Kz10cFt0cF9pbmRleF90XzMrMl07XG5cdCAgICAgIHQrPShiJmluZmxhdGVfbWFza1tlXSk7XG5cdCAgICAgIHRwX2luZGV4X3RfMz0odHBfaW5kZXgrdCkqMztcblx0ICAgICAgZT10cFt0cF9pbmRleF90XzNdO1xuXHQgICAgfVxuXHQgICAgZWxzZXtcblx0ICAgICAgei5tc2cgPSBcImludmFsaWQgZGlzdGFuY2UgY29kZVwiO1xuXG5cdCAgICAgIGM9ei5hdmFpbF9pbi1uO2M9KGs+PjMpPGM/az4+MzpjO24rPWM7cC09YztrLT1jPDwzO1xuXG5cdCAgICAgIHMuYml0Yj1iO3MuYml0az1rO1xuXHQgICAgICB6LmF2YWlsX2luPW47ei50b3RhbF9pbis9cC16Lm5leHRfaW5faW5kZXg7ei5uZXh0X2luX2luZGV4PXA7XG5cdCAgICAgIHMud3JpdGU9cTtcblxuXHQgICAgICByZXR1cm4gWl9EQVRBX0VSUk9SO1xuXHQgICAgfVxuXHQgIH1cblx0ICB3aGlsZSh0cnVlKTtcblx0ICBicmVhaztcblx0fVxuXG5cdGlmKChlJjY0KT09MCl7XG5cdCAgdCs9dHBbdHBfaW5kZXhfdF8zKzJdO1xuXHQgIHQrPShiJmluZmxhdGVfbWFza1tlXSk7XG5cdCAgdHBfaW5kZXhfdF8zPSh0cF9pbmRleCt0KSozO1xuXHQgIGlmKChlPXRwW3RwX2luZGV4X3RfM10pPT0wKXtcblxuXHQgICAgYj4+PSh0cFt0cF9pbmRleF90XzMrMV0pOyBrLT0odHBbdHBfaW5kZXhfdF8zKzFdKTtcblxuXHQgICAgcy53aW5kb3dbcSsrXT10cFt0cF9pbmRleF90XzMrMl07XG5cdCAgICBtLS07XG5cdCAgICBicmVhaztcblx0ICB9XG5cdH1cblx0ZWxzZSBpZigoZSYzMikhPTApe1xuXG5cdCAgYz16LmF2YWlsX2luLW47Yz0oaz4+Myk8Yz9rPj4zOmM7bis9YztwLT1jO2stPWM8PDM7XG4gXG5cdCAgcy5iaXRiPWI7cy5iaXRrPWs7XG5cdCAgei5hdmFpbF9pbj1uO3oudG90YWxfaW4rPXAtei5uZXh0X2luX2luZGV4O3oubmV4dF9pbl9pbmRleD1wO1xuXHQgIHMud3JpdGU9cTtcblxuXHQgIHJldHVybiBaX1NUUkVBTV9FTkQ7XG5cdH1cblx0ZWxzZXtcblx0ICB6Lm1zZz1cImludmFsaWQgbGl0ZXJhbC9sZW5ndGggY29kZVwiO1xuXG5cdCAgYz16LmF2YWlsX2luLW47Yz0oaz4+Myk8Yz9rPj4zOmM7bis9YztwLT1jO2stPWM8PDM7XG5cblx0ICBzLmJpdGI9YjtzLmJpdGs9aztcblx0ICB6LmF2YWlsX2luPW47ei50b3RhbF9pbis9cC16Lm5leHRfaW5faW5kZXg7ei5uZXh0X2luX2luZGV4PXA7XG5cdCAgcy53cml0ZT1xO1xuXG5cdCAgcmV0dXJuIFpfREFUQV9FUlJPUjtcblx0fVxuICAgICAgfSBcbiAgICAgIHdoaWxlKHRydWUpO1xuICAgIH0gXG4gICAgd2hpbGUobT49MjU4ICYmIG4+PSAxMCk7XG5cbiAgICAvLyBub3QgZW5vdWdoIGlucHV0IG9yIG91dHB1dC0tcmVzdG9yZSBwb2ludGVycyBhbmQgcmV0dXJuXG4gICAgYz16LmF2YWlsX2luLW47Yz0oaz4+Myk8Yz9rPj4zOmM7bis9YztwLT1jO2stPWM8PDM7XG5cbiAgICBzLmJpdGI9YjtzLmJpdGs9aztcbiAgICB6LmF2YWlsX2luPW47ei50b3RhbF9pbis9cC16Lm5leHRfaW5faW5kZXg7ei5uZXh0X2luX2luZGV4PXA7XG4gICAgcy53cml0ZT1xO1xuXG4gICAgcmV0dXJuIFpfT0s7XG59XG5cbi8vXG4vLyBJbmZUcmVlLmphdmFcbi8vXG5cbmZ1bmN0aW9uIEluZlRyZWUoKSB7XG59XG5cbkluZlRyZWUucHJvdG90eXBlLmh1ZnRfYnVpbGQgPSBmdW5jdGlvbihiLCBiaW5kZXgsIG4sIHMsIGQsIGUsIHQsIG0sIGhwLCBobiwgdikge1xuXG4gICAgLy8gR2l2ZW4gYSBsaXN0IG9mIGNvZGUgbGVuZ3RocyBhbmQgYSBtYXhpbXVtIHRhYmxlIHNpemUsIG1ha2UgYSBzZXQgb2ZcbiAgICAvLyB0YWJsZXMgdG8gZGVjb2RlIHRoYXQgc2V0IG9mIGNvZGVzLiAgUmV0dXJuIFpfT0sgb24gc3VjY2VzcywgWl9CVUZfRVJST1JcbiAgICAvLyBpZiB0aGUgZ2l2ZW4gY29kZSBzZXQgaXMgaW5jb21wbGV0ZSAodGhlIHRhYmxlcyBhcmUgc3RpbGwgYnVpbHQgaW4gdGhpc1xuICAgIC8vIGNhc2UpLCBaX0RBVEFfRVJST1IgaWYgdGhlIGlucHV0IGlzIGludmFsaWQgKGFuIG92ZXItc3Vic2NyaWJlZCBzZXQgb2ZcbiAgICAvLyBsZW5ndGhzKSwgb3IgWl9NRU1fRVJST1IgaWYgbm90IGVub3VnaCBtZW1vcnkuXG5cbiAgICB2YXIgYTsgICAgICAgICAgICAgICAgICAgICAgIC8vIGNvdW50ZXIgZm9yIGNvZGVzIG9mIGxlbmd0aCBrXG4gICAgdmFyIGY7ICAgICAgICAgICAgICAgICAgICAgICAvLyBpIHJlcGVhdHMgaW4gdGFibGUgZXZlcnkgZiBlbnRyaWVzXG4gICAgdmFyIGc7ICAgICAgICAgICAgICAgICAgICAgICAvLyBtYXhpbXVtIGNvZGUgbGVuZ3RoXG4gICAgdmFyIGg7ICAgICAgICAgICAgICAgICAgICAgICAvLyB0YWJsZSBsZXZlbFxuICAgIHZhciBpOyAgICAgICAgICAgICAgICAgICAgICAgLy8gY291bnRlciwgY3VycmVudCBjb2RlXG4gICAgdmFyIGo7ICAgICAgICAgICAgICAgICAgICAgICAvLyBjb3VudGVyXG4gICAgdmFyIGs7ICAgICAgICAgICAgICAgICAgICAgICAvLyBudW1iZXIgb2YgYml0cyBpbiBjdXJyZW50IGNvZGVcbiAgICB2YXIgbDsgICAgICAgICAgICAgICAgICAgICAgIC8vIGJpdHMgcGVyIHRhYmxlIChyZXR1cm5lZCBpbiBtKVxuICAgIHZhciBtYXNrOyAgICAgICAgICAgICAgICAgICAgLy8gKDEgPDwgdykgLSAxLCB0byBhdm9pZCBjYyAtTyBidWcgb24gSFBcbiAgICB2YXIgcDsgICAgICAgICAgICAgICAgICAgICAgIC8vIHBvaW50ZXIgaW50byBjW10sIGJbXSwgb3IgdltdXG4gICAgdmFyIHE7ICAgICAgICAgICAgICAgICAgICAgICAvLyBwb2ludHMgdG8gY3VycmVudCB0YWJsZVxuICAgIHZhciB3OyAgICAgICAgICAgICAgICAgICAgICAgLy8gYml0cyBiZWZvcmUgdGhpcyB0YWJsZSA9PSAobCAqIGgpXG4gICAgdmFyIHhwOyAgICAgICAgICAgICAgICAgICAgICAvLyBwb2ludGVyIGludG8geFxuICAgIHZhciB5OyAgICAgICAgICAgICAgICAgICAgICAgLy8gbnVtYmVyIG9mIGR1bW15IGNvZGVzIGFkZGVkXG4gICAgdmFyIHo7ICAgICAgICAgICAgICAgICAgICAgICAvLyBudW1iZXIgb2YgZW50cmllcyBpbiBjdXJyZW50IHRhYmxlXG5cbiAgICAvLyBHZW5lcmF0ZSBjb3VudHMgZm9yIGVhY2ggYml0IGxlbmd0aFxuXG4gICAgcCA9IDA7IGkgPSBuO1xuICAgIGRvIHtcbiAgICAgIHRoaXMuY1tiW2JpbmRleCtwXV0rKzsgcCsrOyBpLS07ICAgLy8gYXNzdW1lIGFsbCBlbnRyaWVzIDw9IEJNQVhcbiAgICB9d2hpbGUoaSE9MCk7XG5cbiAgICBpZih0aGlzLmNbMF0gPT0gbil7ICAgICAgICAgICAgICAgIC8vIG51bGwgaW5wdXQtLWFsbCB6ZXJvIGxlbmd0aCBjb2Rlc1xuICAgICAgdFswXSA9IC0xO1xuICAgICAgbVswXSA9IDA7XG4gICAgICByZXR1cm4gWl9PSztcbiAgICB9XG5cbiAgICAvLyBGaW5kIG1pbmltdW0gYW5kIG1heGltdW0gbGVuZ3RoLCBib3VuZCAqbSBieSB0aG9zZVxuICAgIGwgPSBtWzBdO1xuICAgIGZvciAoaiA9IDE7IGogPD0gQk1BWDsgaisrKVxuICAgICAgaWYodGhpcy5jW2pdIT0wKSBicmVhaztcbiAgICBrID0gajsgICAgICAgICAgICAgICAgICAgICAgICAvLyBtaW5pbXVtIGNvZGUgbGVuZ3RoXG4gICAgaWYobCA8IGope1xuICAgICAgbCA9IGo7XG4gICAgfVxuICAgIGZvciAoaSA9IEJNQVg7IGkhPTA7IGktLSl7XG4gICAgICBpZih0aGlzLmNbaV0hPTApIGJyZWFrO1xuICAgIH1cbiAgICBnID0gaTsgICAgICAgICAgICAgICAgICAgICAgICAvLyBtYXhpbXVtIGNvZGUgbGVuZ3RoXG4gICAgaWYobCA+IGkpe1xuICAgICAgbCA9IGk7XG4gICAgfVxuICAgIG1bMF0gPSBsO1xuXG4gICAgLy8gQWRqdXN0IGxhc3QgbGVuZ3RoIGNvdW50IHRvIGZpbGwgb3V0IGNvZGVzLCBpZiBuZWVkZWRcbiAgICBmb3IgKHkgPSAxIDw8IGo7IGogPCBpOyBqKyssIHkgPDw9IDEpe1xuICAgICAgaWYgKCh5IC09IHRoaXMuY1tqXSkgPCAwKXtcbiAgICAgICAgcmV0dXJuIFpfREFUQV9FUlJPUjtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKCh5IC09IHRoaXMuY1tpXSkgPCAwKXtcbiAgICAgIHJldHVybiBaX0RBVEFfRVJST1I7XG4gICAgfVxuICAgIHRoaXMuY1tpXSArPSB5O1xuXG4gICAgLy8gR2VuZXJhdGUgc3RhcnRpbmcgb2Zmc2V0cyBpbnRvIHRoZSB2YWx1ZSB0YWJsZSBmb3IgZWFjaCBsZW5ndGhcbiAgICB0aGlzLnhbMV0gPSBqID0gMDtcbiAgICBwID0gMTsgIHhwID0gMjtcbiAgICB3aGlsZSAoLS1pIT0wKSB7ICAgICAgICAgICAgICAgICAvLyBub3RlIHRoYXQgaSA9PSBnIGZyb20gYWJvdmVcbiAgICAgIHRoaXMueFt4cF0gPSAoaiArPSB0aGlzLmNbcF0pO1xuICAgICAgeHArKztcbiAgICAgIHArKztcbiAgICB9XG5cbiAgICAvLyBNYWtlIGEgdGFibGUgb2YgdmFsdWVzIGluIG9yZGVyIG9mIGJpdCBsZW5ndGhzXG4gICAgaSA9IDA7IHAgPSAwO1xuICAgIGRvIHtcbiAgICAgIGlmICgoaiA9IGJbYmluZGV4K3BdKSAhPSAwKXtcbiAgICAgICAgdGhpcy52W3RoaXMueFtqXSsrXSA9IGk7XG4gICAgICB9XG4gICAgICBwKys7XG4gICAgfVxuICAgIHdoaWxlICgrK2kgPCBuKTtcbiAgICBuID0gdGhpcy54W2ddOyAgICAgICAgICAgICAgICAgICAgIC8vIHNldCBuIHRvIGxlbmd0aCBvZiB2XG5cbiAgICAvLyBHZW5lcmF0ZSB0aGUgSHVmZm1hbiBjb2RlcyBhbmQgZm9yIGVhY2gsIG1ha2UgdGhlIHRhYmxlIGVudHJpZXNcbiAgICB0aGlzLnhbMF0gPSBpID0gMDsgICAgICAgICAgICAgICAgIC8vIGZpcnN0IEh1ZmZtYW4gY29kZSBpcyB6ZXJvXG4gICAgcCA9IDA7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gZ3JhYiB2YWx1ZXMgaW4gYml0IG9yZGVyXG4gICAgaCA9IC0xOyAgICAgICAgICAgICAgICAgICAgICAgLy8gbm8gdGFibGVzIHlldC0tbGV2ZWwgLTFcbiAgICB3ID0gLWw7ICAgICAgICAgICAgICAgICAgICAgICAvLyBiaXRzIGRlY29kZWQgPT0gKGwgKiBoKVxuICAgIHRoaXMudVswXSA9IDA7ICAgICAgICAgICAgICAgICAgICAgLy8ganVzdCB0byBrZWVwIGNvbXBpbGVycyBoYXBweVxuICAgIHEgPSAwOyAgICAgICAgICAgICAgICAgICAgICAgIC8vIGRpdHRvXG4gICAgeiA9IDA7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gZGl0dG9cblxuICAgIC8vIGdvIHRocm91Z2ggdGhlIGJpdCBsZW5ndGhzIChrIGFscmVhZHkgaXMgYml0cyBpbiBzaG9ydGVzdCBjb2RlKVxuICAgIGZvciAoOyBrIDw9IGc7IGsrKyl7XG4gICAgICBhID0gdGhpcy5jW2tdO1xuICAgICAgd2hpbGUgKGEtLSE9MCl7XG5cdC8vIGhlcmUgaSBpcyB0aGUgSHVmZm1hbiBjb2RlIG9mIGxlbmd0aCBrIGJpdHMgZm9yIHZhbHVlICpwXG5cdC8vIG1ha2UgdGFibGVzIHVwIHRvIHJlcXVpcmVkIGxldmVsXG4gICAgICAgIHdoaWxlIChrID4gdyArIGwpe1xuICAgICAgICAgIGgrKztcbiAgICAgICAgICB3ICs9IGw7ICAgICAgICAgICAgICAgICAvLyBwcmV2aW91cyB0YWJsZSBhbHdheXMgbCBiaXRzXG5cdCAgLy8gY29tcHV0ZSBtaW5pbXVtIHNpemUgdGFibGUgbGVzcyB0aGFuIG9yIGVxdWFsIHRvIGwgYml0c1xuICAgICAgICAgIHogPSBnIC0gdztcbiAgICAgICAgICB6ID0gKHogPiBsKSA/IGwgOiB6OyAgICAgICAgLy8gdGFibGUgc2l6ZSB1cHBlciBsaW1pdFxuICAgICAgICAgIGlmKChmPTE8PChqPWstdykpPmErMSl7ICAgICAvLyB0cnkgYSBrLXcgYml0IHRhYmxlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRvbyBmZXcgY29kZXMgZm9yIGstdyBiaXQgdGFibGVcbiAgICAgICAgICAgIGYgLT0gYSArIDE7ICAgICAgICAgICAgICAgLy8gZGVkdWN0IGNvZGVzIGZyb20gcGF0dGVybnMgbGVmdFxuICAgICAgICAgICAgeHAgPSBrO1xuICAgICAgICAgICAgaWYoaiA8IHope1xuICAgICAgICAgICAgICB3aGlsZSAoKytqIDwgeil7ICAgICAgICAvLyB0cnkgc21hbGxlciB0YWJsZXMgdXAgdG8geiBiaXRzXG4gICAgICAgICAgICAgICAgaWYoKGYgPDw9IDEpIDw9IHRoaXMuY1srK3hwXSlcbiAgICAgICAgICAgICAgICAgIGJyZWFrOyAgICAgICAgICAgICAgLy8gZW5vdWdoIGNvZGVzIHRvIHVzZSB1cCBqIGJpdHNcbiAgICAgICAgICAgICAgICBmIC09IHRoaXMuY1t4cF07ICAgICAgICAgICAvLyBlbHNlIGRlZHVjdCBjb2RlcyBmcm9tIHBhdHRlcm5zXG4gICAgICAgICAgICAgIH1cblx0ICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgeiA9IDEgPDwgajsgICAgICAgICAgICAgICAgIC8vIHRhYmxlIGVudHJpZXMgZm9yIGotYml0IHRhYmxlXG5cblx0ICAvLyBhbGxvY2F0ZSBuZXcgdGFibGVcbiAgICAgICAgICBpZiAodGhpcy5oblswXSArIHogPiBNQU5ZKXsgICAgICAgLy8gKG5vdGU6IGRvZXNuJ3QgbWF0dGVyIGZvciBmaXhlZClcbiAgICAgICAgICAgIHJldHVybiBaX0RBVEFfRVJST1I7ICAgICAgIC8vIG92ZXJmbG93IG9mIE1BTllcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy51W2hdID0gcSA9IC8qaHArKi8gdGhpcy5oblswXTsgICAvLyBERUJVR1xuICAgICAgICAgIHRoaXMuaG5bMF0gKz0gejtcbiBcblx0ICAvLyBjb25uZWN0IHRvIGxhc3QgdGFibGUsIGlmIHRoZXJlIGlzIG9uZVxuXHQgIGlmKGghPTApe1xuICAgICAgICAgICAgdGhpcy54W2hdPWk7ICAgICAgICAgICAvLyBzYXZlIHBhdHRlcm4gZm9yIGJhY2tpbmcgdXBcbiAgICAgICAgICAgIHRoaXMuclswXT1qOyAgICAgLy8gYml0cyBpbiB0aGlzIHRhYmxlXG4gICAgICAgICAgICB0aGlzLnJbMV09bDsgICAgIC8vIGJpdHMgdG8gZHVtcCBiZWZvcmUgdGhpcyB0YWJsZVxuICAgICAgICAgICAgaj1pPj4+KHcgLSBsKTtcbiAgICAgICAgICAgIHRoaXMuclsyXSA9IChxIC0gdGhpcy51W2gtMV0gLSBqKTsgICAgICAgICAgICAgICAvLyBvZmZzZXQgdG8gdGhpcyB0YWJsZVxuICAgICAgICAgICAgYXJyYXlDb3B5KHRoaXMuciwgMCwgaHAsICh0aGlzLnVbaC0xXStqKSozLCAzKTsgLy8gY29ubmVjdCB0byBsYXN0IHRhYmxlXG4gICAgICAgICAgfVxuICAgICAgICAgIGVsc2V7XG4gICAgICAgICAgICB0WzBdID0gcTsgICAgICAgICAgICAgICAvLyBmaXJzdCB0YWJsZSBpcyByZXR1cm5lZCByZXN1bHRcblx0ICB9XG4gICAgICAgIH1cblxuXHQvLyBzZXQgdXAgdGFibGUgZW50cnkgaW4gclxuICAgICAgICB0aGlzLnJbMV0gPSAoayAtIHcpO1xuICAgICAgICBpZiAocCA+PSBuKXtcbiAgICAgICAgICB0aGlzLnJbMF0gPSAxMjggKyA2NDsgICAgICAvLyBvdXQgb2YgdmFsdWVzLS1pbnZhbGlkIGNvZGVcblx0fVxuICAgICAgICBlbHNlIGlmICh2W3BdIDwgcyl7XG4gICAgICAgICAgdGhpcy5yWzBdID0gKHRoaXMudltwXSA8IDI1NiA/IDAgOiAzMiArIDY0KTsgIC8vIDI1NiBpcyBlbmQtb2YtYmxvY2tcbiAgICAgICAgICB0aGlzLnJbMl0gPSB0aGlzLnZbcCsrXTsgICAgICAgICAgLy8gc2ltcGxlIGNvZGUgaXMganVzdCB0aGUgdmFsdWVcbiAgICAgICAgfVxuICAgICAgICBlbHNle1xuICAgICAgICAgIHRoaXMuclswXT0oZVt0aGlzLnZbcF0tc10rMTYrNjQpOyAvLyBub24tc2ltcGxlLS1sb29rIHVwIGluIGxpc3RzXG4gICAgICAgICAgdGhpcy5yWzJdPWRbdGhpcy52W3ArK10gLSBzXTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGZpbGwgY29kZS1saWtlIGVudHJpZXMgd2l0aCByXG4gICAgICAgIGY9MTw8KGstdyk7XG4gICAgICAgIGZvciAoaj1pPj4+dztqPHo7ais9Zil7XG4gICAgICAgICAgYXJyYXlDb3B5KHRoaXMuciwgMCwgaHAsIChxK2opKjMsIDMpO1xuXHR9XG5cblx0Ly8gYmFja3dhcmRzIGluY3JlbWVudCB0aGUgay1iaXQgY29kZSBpXG4gICAgICAgIGZvciAoaiA9IDEgPDwgKGsgLSAxKTsgKGkgJiBqKSE9MDsgaiA+Pj49IDEpe1xuICAgICAgICAgIGkgXj0gajtcblx0fVxuICAgICAgICBpIF49IGo7XG5cblx0Ly8gYmFja3VwIG92ZXIgZmluaXNoZWQgdGFibGVzXG4gICAgICAgIG1hc2sgPSAoMSA8PCB3KSAtIDE7ICAgICAgLy8gbmVlZGVkIG9uIEhQLCBjYyAtTyBidWdcbiAgICAgICAgd2hpbGUgKChpICYgbWFzaykgIT0gdGhpcy54W2hdKXtcbiAgICAgICAgICBoLS07ICAgICAgICAgICAgICAgICAgICAvLyBkb24ndCBuZWVkIHRvIHVwZGF0ZSBxXG4gICAgICAgICAgdyAtPSBsO1xuICAgICAgICAgIG1hc2sgPSAoMSA8PCB3KSAtIDE7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgLy8gUmV0dXJuIFpfQlVGX0VSUk9SIGlmIHdlIHdlcmUgZ2l2ZW4gYW4gaW5jb21wbGV0ZSB0YWJsZVxuICAgIHJldHVybiB5ICE9IDAgJiYgZyAhPSAxID8gWl9CVUZfRVJST1IgOiBaX09LO1xufVxuXG5JbmZUcmVlLnByb3RvdHlwZS5pbmZsYXRlX3RyZWVzX2JpdHMgPSBmdW5jdGlvbihjLCBiYiwgdGIsIGhwLCB6KSB7XG4gICAgdmFyIHJlc3VsdDtcbiAgICB0aGlzLmluaXRXb3JrQXJlYSgxOSk7XG4gICAgdGhpcy5oblswXT0wO1xuICAgIHJlc3VsdCA9IHRoaXMuaHVmdF9idWlsZChjLCAwLCAxOSwgMTksIG51bGwsIG51bGwsIHRiLCBiYiwgaHAsIHRoaXMuaG4sIHRoaXMudik7XG5cbiAgICBpZihyZXN1bHQgPT0gWl9EQVRBX0VSUk9SKXtcbiAgICAgIHoubXNnID0gXCJvdmVyc3Vic2NyaWJlZCBkeW5hbWljIGJpdCBsZW5ndGhzIHRyZWVcIjtcbiAgICB9XG4gICAgZWxzZSBpZihyZXN1bHQgPT0gWl9CVUZfRVJST1IgfHwgYmJbMF0gPT0gMCl7XG4gICAgICB6Lm1zZyA9IFwiaW5jb21wbGV0ZSBkeW5hbWljIGJpdCBsZW5ndGhzIHRyZWVcIjtcbiAgICAgIHJlc3VsdCA9IFpfREFUQV9FUlJPUjtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxuSW5mVHJlZS5wcm90b3R5cGUuaW5mbGF0ZV90cmVlc19keW5hbWljID0gZnVuY3Rpb24obmwsIG5kLCBjLCBibCwgYmQsIHRsLCB0ZCwgaHAsIHopIHtcbiAgICB2YXIgcmVzdWx0O1xuXG4gICAgLy8gYnVpbGQgbGl0ZXJhbC9sZW5ndGggdHJlZVxuICAgIHRoaXMuaW5pdFdvcmtBcmVhKDI4OCk7XG4gICAgdGhpcy5oblswXT0wO1xuICAgIHJlc3VsdCA9IHRoaXMuaHVmdF9idWlsZChjLCAwLCBubCwgMjU3LCBjcGxlbnMsIGNwbGV4dCwgdGwsIGJsLCBocCwgdGhpcy5obiwgdGhpcy52KTtcbiAgICBpZiAocmVzdWx0ICE9IFpfT0sgfHwgYmxbMF0gPT0gMCl7XG4gICAgICBpZihyZXN1bHQgPT0gWl9EQVRBX0VSUk9SKXtcbiAgICAgICAgei5tc2cgPSBcIm92ZXJzdWJzY3JpYmVkIGxpdGVyYWwvbGVuZ3RoIHRyZWVcIjtcbiAgICAgIH1cbiAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPSBaX01FTV9FUlJPUil7XG4gICAgICAgIHoubXNnID0gXCJpbmNvbXBsZXRlIGxpdGVyYWwvbGVuZ3RoIHRyZWVcIjtcbiAgICAgICAgcmVzdWx0ID0gWl9EQVRBX0VSUk9SO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICAvLyBidWlsZCBkaXN0YW5jZSB0cmVlXG4gICAgdGhpcy5pbml0V29ya0FyZWEoMjg4KTtcbiAgICByZXN1bHQgPSB0aGlzLmh1ZnRfYnVpbGQoYywgbmwsIG5kLCAwLCBjcGRpc3QsIGNwZGV4dCwgdGQsIGJkLCBocCwgdGhpcy5obiwgdGhpcy52KTtcblxuICAgIGlmIChyZXN1bHQgIT0gWl9PSyB8fCAoYmRbMF0gPT0gMCAmJiBubCA+IDI1Nykpe1xuICAgICAgaWYgKHJlc3VsdCA9PSBaX0RBVEFfRVJST1Ipe1xuICAgICAgICB6Lm1zZyA9IFwib3ZlcnN1YnNjcmliZWQgZGlzdGFuY2UgdHJlZVwiO1xuICAgICAgfVxuICAgICAgZWxzZSBpZiAocmVzdWx0ID09IFpfQlVGX0VSUk9SKSB7XG4gICAgICAgIHoubXNnID0gXCJpbmNvbXBsZXRlIGRpc3RhbmNlIHRyZWVcIjtcbiAgICAgICAgcmVzdWx0ID0gWl9EQVRBX0VSUk9SO1xuICAgICAgfVxuICAgICAgZWxzZSBpZiAocmVzdWx0ICE9IFpfTUVNX0VSUk9SKXtcbiAgICAgICAgei5tc2cgPSBcImVtcHR5IGRpc3RhbmNlIHRyZWUgd2l0aCBsZW5ndGhzXCI7XG4gICAgICAgIHJlc3VsdCA9IFpfREFUQV9FUlJPUjtcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIFpfT0s7XG59XG4vKlxuICBzdGF0aWMgaW50IGluZmxhdGVfdHJlZXNfZml4ZWQoaW50W10gYmwsICAvL2xpdGVyYWwgZGVzaXJlZC9hY3R1YWwgYml0IGRlcHRoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnRbXSBiZCwgIC8vZGlzdGFuY2UgZGVzaXJlZC9hY3R1YWwgYml0IGRlcHRoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnRbXVtdIHRsLC8vbGl0ZXJhbC9sZW5ndGggdHJlZSByZXN1bHRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGludFtdW10gdGQsLy9kaXN0YW5jZSB0cmVlIHJlc3VsdCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFpTdHJlYW0geiAgLy9mb3IgbWVtb3J5IGFsbG9jYXRpb25cblx0XHRcdFx0ICl7XG5cbiovXG5cbmZ1bmN0aW9uIGluZmxhdGVfdHJlZXNfZml4ZWQoYmwsIGJkLCB0bCwgdGQsIHopIHtcbiAgICBibFswXT1maXhlZF9ibDtcbiAgICBiZFswXT1maXhlZF9iZDtcbiAgICB0bFswXT1maXhlZF90bDtcbiAgICB0ZFswXT1maXhlZF90ZDtcbiAgICByZXR1cm4gWl9PSztcbn1cblxuSW5mVHJlZS5wcm90b3R5cGUuaW5pdFdvcmtBcmVhID0gZnVuY3Rpb24odnNpemUpe1xuICAgIGlmKHRoaXMuaG49PW51bGwpe1xuICAgICAgICB0aGlzLmhuPW5ldyBJbnQzMkFycmF5KDEpO1xuICAgICAgICB0aGlzLnY9bmV3IEludDMyQXJyYXkodnNpemUpO1xuICAgICAgICB0aGlzLmM9bmV3IEludDMyQXJyYXkoQk1BWCsxKTtcbiAgICAgICAgdGhpcy5yPW5ldyBJbnQzMkFycmF5KDMpO1xuICAgICAgICB0aGlzLnU9bmV3IEludDMyQXJyYXkoQk1BWCk7XG4gICAgICAgIHRoaXMueD1uZXcgSW50MzJBcnJheShCTUFYKzEpO1xuICAgIH1cbiAgICBpZih0aGlzLnYubGVuZ3RoPHZzaXplKXsgXG4gICAgICAgIHRoaXMudj1uZXcgSW50MzJBcnJheSh2c2l6ZSk7IFxuICAgIH1cbiAgICBmb3IodmFyIGk9MDsgaTx2c2l6ZTsgaSsrKXt0aGlzLnZbaV09MDt9XG4gICAgZm9yKHZhciBpPTA7IGk8Qk1BWCsxOyBpKyspe3RoaXMuY1tpXT0wO31cbiAgICBmb3IodmFyIGk9MDsgaTwzOyBpKyspe3RoaXMucltpXT0wO31cbi8vICBmb3IoaW50IGk9MDsgaTxCTUFYOyBpKyspe3VbaV09MDt9XG4gICAgYXJyYXlDb3B5KHRoaXMuYywgMCwgdGhpcy51LCAwLCBCTUFYKTtcbi8vICBmb3IoaW50IGk9MDsgaTxCTUFYKzE7IGkrKyl7eFtpXT0wO31cbiAgICBhcnJheUNvcHkodGhpcy5jLCAwLCB0aGlzLngsIDAsIEJNQVgrMSk7XG59XG5cbnZhciB0ZXN0QXJyYXkgPSBuZXcgVWludDhBcnJheSgxKTtcbnZhciBoYXNTdWJhcnJheSA9ICh0eXBlb2YgdGVzdEFycmF5LnN1YmFycmF5ID09PSAnZnVuY3Rpb24nKTtcbnZhciBoYXNTbGljZSA9IGZhbHNlOyAvKiAodHlwZW9mIHRlc3RBcnJheS5zbGljZSA9PT0gJ2Z1bmN0aW9uJyk7ICovIC8vIENocm9tZSBzbGljZSBwZXJmb3JtYW5jZSBpcyBzbyBkaXJlIHRoYXQgd2UncmUgY3VycmVudGx5IG5vdCB1c2luZyBpdC4uLlxuXG5mdW5jdGlvbiBhcnJheUNvcHkoc3JjLCBzcmNPZmZzZXQsIGRlc3QsIGRlc3RPZmZzZXQsIGNvdW50KSB7XG4gICAgaWYgKGNvdW50ID09IDApIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH0gXG4gICAgaWYgKCFzcmMpIHtcbiAgICAgICAgdGhyb3cgXCJVbmRlZiBzcmNcIjtcbiAgICB9IGVsc2UgaWYgKCFkZXN0KSB7XG4gICAgICAgIHRocm93IFwiVW5kZWYgZGVzdFwiO1xuICAgIH1cblxuICAgIGlmIChzcmNPZmZzZXQgPT0gMCAmJiBjb3VudCA9PSBzcmMubGVuZ3RoKSB7XG4gICAgICAgIGFycmF5Q29weV9mYXN0KHNyYywgZGVzdCwgZGVzdE9mZnNldCk7XG4gICAgfSBlbHNlIGlmIChoYXNTdWJhcnJheSkge1xuICAgICAgICBhcnJheUNvcHlfZmFzdChzcmMuc3ViYXJyYXkoc3JjT2Zmc2V0LCBzcmNPZmZzZXQgKyBjb3VudCksIGRlc3QsIGRlc3RPZmZzZXQpOyBcbiAgICB9IGVsc2UgaWYgKHNyYy5CWVRFU19QRVJfRUxFTUVOVCA9PSAxICYmIGNvdW50ID4gMTAwKSB7XG4gICAgICAgIGFycmF5Q29weV9mYXN0KG5ldyBVaW50OEFycmF5KHNyYy5idWZmZXIsIHNyYy5ieXRlT2Zmc2V0ICsgc3JjT2Zmc2V0LCBjb3VudCksIGRlc3QsIGRlc3RPZmZzZXQpO1xuICAgIH0gZWxzZSB7IFxuICAgICAgICBhcnJheUNvcHlfc2xvdyhzcmMsIHNyY09mZnNldCwgZGVzdCwgZGVzdE9mZnNldCwgY291bnQpO1xuICAgIH1cblxufVxuXG5mdW5jdGlvbiBhcnJheUNvcHlfc2xvdyhzcmMsIHNyY09mZnNldCwgZGVzdCwgZGVzdE9mZnNldCwgY291bnQpIHtcblxuICAgIC8vIGRsb2coJ19zbG93IGNhbGw6IHNyY09mZnNldD0nICsgc3JjT2Zmc2V0ICsgJzsgZGVzdE9mZnNldD0nICsgZGVzdE9mZnNldCArICc7IGNvdW50PScgKyBjb3VudCk7XG5cbiAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjb3VudDsgKytpKSB7XG4gICAgICAgIGRlc3RbZGVzdE9mZnNldCArIGldID0gc3JjW3NyY09mZnNldCArIGldO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gYXJyYXlDb3B5X2Zhc3Qoc3JjLCBkZXN0LCBkZXN0T2Zmc2V0KSB7XG4gICAgZGVzdC5zZXQoc3JjLCBkZXN0T2Zmc2V0KTtcbn1cblxuXG4gIC8vIGxhcmdlc3QgcHJpbWUgc21hbGxlciB0aGFuIDY1NTM2XG52YXIgQURMRVJfQkFTRT02NTUyMTsgXG4gIC8vIE5NQVggaXMgdGhlIGxhcmdlc3QgbiBzdWNoIHRoYXQgMjU1bihuKzEpLzIgKyAobisxKShCQVNFLTEpIDw9IDJeMzItMVxudmFyIEFETEVSX05NQVg9NTU1MjtcblxuZnVuY3Rpb24gYWRsZXIzMihhZGxlciwgLyogYnl0ZVtdICovIGJ1ZiwgIGluZGV4LCBsZW4pe1xuICAgIGlmKGJ1ZiA9PSBudWxsKXsgcmV0dXJuIDE7IH1cblxuICAgIHZhciBzMT1hZGxlciYweGZmZmY7XG4gICAgdmFyIHMyPShhZGxlcj4+MTYpJjB4ZmZmZjtcbiAgICB2YXIgaztcblxuICAgIHdoaWxlKGxlbiA+IDApIHtcbiAgICAgIGs9bGVuPEFETEVSX05NQVg/bGVuOkFETEVSX05NQVg7XG4gICAgICBsZW4tPWs7XG4gICAgICB3aGlsZShrPj0xNil7XG4gICAgICAgIHMxKz1idWZbaW5kZXgrK10mMHhmZjsgczIrPXMxO1xuICAgICAgICBzMSs9YnVmW2luZGV4KytdJjB4ZmY7IHMyKz1zMTtcbiAgICAgICAgczErPWJ1ZltpbmRleCsrXSYweGZmOyBzMis9czE7XG4gICAgICAgIHMxKz1idWZbaW5kZXgrK10mMHhmZjsgczIrPXMxO1xuICAgICAgICBzMSs9YnVmW2luZGV4KytdJjB4ZmY7IHMyKz1zMTtcbiAgICAgICAgczErPWJ1ZltpbmRleCsrXSYweGZmOyBzMis9czE7XG4gICAgICAgIHMxKz1idWZbaW5kZXgrK10mMHhmZjsgczIrPXMxO1xuICAgICAgICBzMSs9YnVmW2luZGV4KytdJjB4ZmY7IHMyKz1zMTtcbiAgICAgICAgczErPWJ1ZltpbmRleCsrXSYweGZmOyBzMis9czE7XG4gICAgICAgIHMxKz1idWZbaW5kZXgrK10mMHhmZjsgczIrPXMxO1xuICAgICAgICBzMSs9YnVmW2luZGV4KytdJjB4ZmY7IHMyKz1zMTtcbiAgICAgICAgczErPWJ1ZltpbmRleCsrXSYweGZmOyBzMis9czE7XG4gICAgICAgIHMxKz1idWZbaW5kZXgrK10mMHhmZjsgczIrPXMxO1xuICAgICAgICBzMSs9YnVmW2luZGV4KytdJjB4ZmY7IHMyKz1zMTtcbiAgICAgICAgczErPWJ1ZltpbmRleCsrXSYweGZmOyBzMis9czE7XG4gICAgICAgIHMxKz1idWZbaW5kZXgrK10mMHhmZjsgczIrPXMxO1xuICAgICAgICBrLT0xNjtcbiAgICAgIH1cbiAgICAgIGlmKGshPTApe1xuICAgICAgICBkb3tcbiAgICAgICAgICBzMSs9YnVmW2luZGV4KytdJjB4ZmY7IHMyKz1zMTtcbiAgICAgICAgfVxuICAgICAgICB3aGlsZSgtLWshPTApO1xuICAgICAgfVxuICAgICAgczElPUFETEVSX0JBU0U7XG4gICAgICBzMiU9QURMRVJfQkFTRTtcbiAgICB9XG4gICAgcmV0dXJuIChzMjw8MTYpfHMxO1xufVxuXG5cblxuZnVuY3Rpb24ganN6bGliX2luZmxhdGVfYnVmZmVyKGJ1ZmZlciwgc3RhcnQsIGxlbmd0aCwgYWZ0ZXJVbmNPZmZzZXQpIHtcbiAgICBpZiAoIXN0YXJ0KSB7XG4gICAgICAgIGJ1ZmZlciA9IG5ldyBVaW50OEFycmF5KGJ1ZmZlcik7XG4gICAgfSBlbHNlIGlmICghbGVuZ3RoKSB7XG4gICAgICAgIGJ1ZmZlciA9IG5ldyBVaW50OEFycmF5KGJ1ZmZlciwgc3RhcnQsIGJ1ZmZlci5ieXRlTGVuZ3RoIC0gc3RhcnQpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGJ1ZmZlciA9IG5ldyBVaW50OEFycmF5KGJ1ZmZlciwgc3RhcnQsIGxlbmd0aCk7XG4gICAgfVxuXG4gICAgdmFyIHogPSBuZXcgWlN0cmVhbSgpO1xuICAgIHouaW5mbGF0ZUluaXQoREVGX1dCSVRTLCB0cnVlKTtcbiAgICB6Lm5leHRfaW4gPSBidWZmZXI7XG4gICAgei5uZXh0X2luX2luZGV4ID0gMDtcbiAgICB6LmF2YWlsX2luID0gYnVmZmVyLmxlbmd0aDtcblxuICAgIHZhciBvQmxvY2tMaXN0ID0gW107XG4gICAgdmFyIHRvdGFsU2l6ZSA9IDA7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgdmFyIG9idWYgPSBuZXcgVWludDhBcnJheSgzMjAwMCk7XG4gICAgICAgIHoubmV4dF9vdXQgPSBvYnVmO1xuICAgICAgICB6Lm5leHRfb3V0X2luZGV4ID0gMDtcbiAgICAgICAgei5hdmFpbF9vdXQgPSBvYnVmLmxlbmd0aDtcbiAgICAgICAgdmFyIHN0YXR1cyA9IHouaW5mbGF0ZShaX05PX0ZMVVNIKTtcbiAgICAgICAgaWYgKHN0YXR1cyAhPSBaX09LICYmIHN0YXR1cyAhPSBaX1NUUkVBTV9FTkQgJiYgc3RhdHVzICE9IFpfQlVGX0VSUk9SKSB7XG4gICAgICAgICAgICB0aHJvdyB6Lm1zZztcbiAgICAgICAgfVxuICAgICAgICBpZiAoei5hdmFpbF9vdXQgIT0gMCkge1xuICAgICAgICAgICAgdmFyIG5ld29iID0gbmV3IFVpbnQ4QXJyYXkob2J1Zi5sZW5ndGggLSB6LmF2YWlsX291dCk7XG4gICAgICAgICAgICBhcnJheUNvcHkob2J1ZiwgMCwgbmV3b2IsIDAsIChvYnVmLmxlbmd0aCAtIHouYXZhaWxfb3V0KSk7XG4gICAgICAgICAgICBvYnVmID0gbmV3b2I7XG4gICAgICAgIH1cbiAgICAgICAgb0Jsb2NrTGlzdC5wdXNoKG9idWYpO1xuICAgICAgICB0b3RhbFNpemUgKz0gb2J1Zi5sZW5ndGg7XG4gICAgICAgIGlmIChzdGF0dXMgPT0gWl9TVFJFQU1fRU5EIHx8IHN0YXR1cyA9PSBaX0JVRl9FUlJPUikge1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYWZ0ZXJVbmNPZmZzZXQpIHtcbiAgICAgICAgYWZ0ZXJVbmNPZmZzZXRbMF0gPSAoc3RhcnQgfHwgMCkgKyB6Lm5leHRfaW5faW5kZXg7XG4gICAgfVxuXG4gICAgaWYgKG9CbG9ja0xpc3QubGVuZ3RoID09IDEpIHtcbiAgICAgICAgcmV0dXJuIG9CbG9ja0xpc3RbMF0uYnVmZmVyO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBvdXQgPSBuZXcgVWludDhBcnJheSh0b3RhbFNpemUpO1xuICAgICAgICB2YXIgY3Vyc29yID0gMDtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBvQmxvY2tMaXN0Lmxlbmd0aDsgKytpKSB7XG4gICAgICAgICAgICB2YXIgYiA9IG9CbG9ja0xpc3RbaV07XG4gICAgICAgICAgICBhcnJheUNvcHkoYiwgMCwgb3V0LCBjdXJzb3IsIGIubGVuZ3RoKTtcbiAgICAgICAgICAgIGN1cnNvciArPSBiLmxlbmd0aDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gb3V0LmJ1ZmZlcjtcbiAgICB9XG59XG5cbmlmICh0eXBlb2YobW9kdWxlKSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgaW5mbGF0ZUJ1ZmZlcjoganN6bGliX2luZmxhdGVfYnVmZmVyLFxuICAgIGFycmF5Q29weTogYXJyYXlDb3B5XG4gIH07XG59XG4iXX0=
