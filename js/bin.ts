import Utils from './utils';
import SHA1 from './sha1';

class FileReaderSync {
  /**
   * @see http://www.w3.org/TR/FileAPI/#FileReaderSyncSync
   * @constructor
   */
  constructor() { }

  /**
  * @see http://www.w3.org/TR/FileAPI/#dfn-readAsArrayBufferSync
  * @param {!Blob} blob
  */
  readAsArrayBuffer(blob: Blob) { };

  /**
   * @see http://www.w3.org/TR/FileAPI/#dfn-readAsBinaryStringSync
   * @param {!Blob} blob
   */
  readAsBinaryString(blob: Blob) { };

  /**
   * @see http://www.w3.org/TR/FileAPI/#dfn-readAsTextSync
   * @param {!Blob} blob
   * @param {string=} encoding
   */
  readAsText(blob: Blob, encoding: string) { };

  /**
   * @see http://www.w3.org/TR/FileAPI/#dfn-readAsDataURLSync
   * @param {!Blob} blob
   */
  readAsDataURL(blob: Blob) { };

}

abstract class Fetchable {
  abstract slice(s: number, l: number): Fetchable;
  abstract salted(): Fetchable;
  abstract fetch(callback: any, opt?: any): void;

  static bstringToBuffer(result: string): ArrayBuffer {
    if (!result) {
      return null;
    }

    var ba = new Uint8Array(result.length);
    for (var i = 0; i < ba.length; ++i) {
      ba[i] = result.charCodeAt(i);
    }
    return ba.buffer;
  }
}

export class BlobFetchable extends Fetchable{
  blob: Blob;

  constructor(blob: Blob) {
    super();
    this.blob = blob;
  }

  slice(start: number, length: number): BlobFetchable {
    let b;

    if (this.blob.slice) {
      if (length) {
        b = this.blob.slice(start, start + length);
      } else {
        b = this.blob.slice(start);
      }
    } else {
      if (length) {
        b = (<any>this.blob).webkitSlice(start, start + length);
      } else {
        b = (<any>this.blob).webkitSlice(start);
      }
    }
    return new BlobFetchable(b);
  }

  salted(): BlobFetchable {
    return this;
  }

  fetch(callback: any): void {
    if (typeof (FileReader) !== 'undefined') {
      // console.log('defining async BlobFetchable.fetch');
      const reader = new FileReader();
      reader.onloadend = function (ev) {
        callback(BlobFetchable.bstringToBuffer(reader.result));
      };
      reader.readAsBinaryString(this.blob);

    } else {
      // if (console && console.log)
      //    console.log('defining sync BlobFetchable.fetch');
      const reader = new FileReaderSync();
      try {
        const res = reader.readAsArrayBuffer(this.blob);
        callback(res);
      } catch (e) {
        callback(null, e);
      }
    }
  }
}

export class URLFetchable extends Fetchable {
  opts: any;
  end: number;
  start: number;
  url: string;
  static seed = 0;
  static isSafari: boolean = navigator.userAgent.indexOf('Safari') >= 0 && navigator.userAgent.indexOf('Chrome') < 0;

  constructor(url: string, start: number, end: number, opts: any) {
    super();
    if (!opts) {
      if (typeof start === 'object') {
        opts = start;
        start = undefined;
      } else {
        opts = {};
      }
    }
    this.url = url;
    this.start = start || 0;
    if (end) {
      this.end = end;
    }
    this.opts = opts;
  }

  slice(s: number, l: number): URLFetchable {
    if (s < 0) {
      throw 'Bad slice ' + s;
    }

    let ns = this.start, ne = this.end;
    if (ns && s) {
      ns = ns + s;
    } else {
      ns = s || ns;
    }
    if (l && ns) {
      ne = ns + l - 1;
    } else {
      ne = ne || l - 1;
    }
    return new URLFetchable(this.url, ns, ne, this.opts);
  }

  fetchAsText(callback: any): any {
    try {
      const req = new XMLHttpRequest();
      let length;
      let url = this.url;
      if ((URLFetchable.isSafari || this.opts.salt) && url.indexOf('?') < 0) {
        const sha1 = new SHA1('' + Date.now() + ',' + (++URLFetchable.seed));
        url = url + '?salt=' + sha1.b64_sha1;
      }
      req.open('GET', url, true);

      if (this.end) {
        if (this.end - this.start > 100000000) {
          throw 'Monster fetch!';
        }
        req.setRequestHeader('Range', 'bytes=' + this.start + '-' + this.end);
        length = this.end - this.start + 1;
      }

      req.onreadystatechange = function () {
        if (req.readyState == 4) {
          if (req.status == 200 || req.status == 206) {
            return callback(req.responseText);
          } else {
            return callback(null);
          }
        }
      };
      if (this.opts.credentials) {
        req.withCredentials = true;
      }
      req.send('');
    } catch (e) {
      return callback(null);
    }
  }

  salted(): URLFetchable {
    const o = Utils.shallowCopy(this.opts);
    o.salt = true;
    return new URLFetchable(this.url, this.start, this.end, o);
  }

  fetch(callback: any, opts: any): any {
    const thisB = this;

    opts = opts || {};
    const attempt = opts.attempt || 1;
    const truncatedLength = opts.truncatedLength;
    if (attempt > 3) {
      return callback(null);
    }

    try {
      let timeout: number;
      if (opts.timeout && !this.opts.credentials) {
        timeout = setTimeout(
          function () {
            console.log('timing out ' + url);
            req.abort();
            return callback(null, 'Timeout');
          },
          opts.timeout
        );
      }

      const req = new XMLHttpRequest();
      let length: number;
      let url = this.url;
      if ((URLFetchable.isSafari || this.opts.salt) && url.indexOf('?') < 0) {
        const sha1 = new SHA1('' + Date.now() + ',' + (++URLFetchable.seed));
        url = url + '?salt=' + sha1.b64_sha1;
      }
      req.open('GET', url, true);
      req.overrideMimeType('text/plain; charset=x-user-defined');
      if (this.end) {
        if (this.end - this.start > 100000000) {
          throw 'Monster fetch!';
        }
        req.setRequestHeader('Range', 'bytes=' + this.start + '-' + this.end);
        length = this.end - this.start + 1;
      }
      req.responseType = 'arraybuffer';
      req.onreadystatechange = function () {
        if (req.readyState == 4) {
          if (timeout)
            clearTimeout(timeout);
          if (req.status == 200 || req.status == 206) {
            if (req.response) {
              var bl = req.response.byteLength;
              if (length && length != bl && (!truncatedLength || bl != truncatedLength)) {
                return thisB.fetch(callback, { attempt: attempt + 1, truncatedLength: bl });
              } else {
                return callback(req.response);
              }
            } else if ((<any>req).mozResponseArrayBuffer) {
              return callback((<any>req).mozResponseArrayBuffer);
            } else {
              var r = req.responseText;
              if (length && length != r.length && (!truncatedLength || r.length != truncatedLength)) {
                return thisB.fetch(callback, { attempt: attempt + 1, truncatedLength: r.length });
              } else {
                return callback(URLFetchable.bstringToBuffer(req.responseText));
              }
            }
          } else {
            return thisB.fetch(callback, { attempt: attempt + 1 });
          }
        }
      };
      if (this.opts.credentials) {
        req.withCredentials = true;
      }
      req.send('');
    } catch (e) {
      return callback(null);
    }
  }

}

export class NumberReader {
  static readInt(ba: Uint8Array , offset: number): number {
    return (ba[offset + 3] << 24) | (ba[offset + 2] << 16) | (ba[offset + 1] << 8) | (ba[offset]);
  }

  static readInt64(ba: Uint8Array , offset: number): number {
    return (ba[offset + 7] << 24) | (ba[offset + 6] << 16) | (ba[offset + 5] << 8) | (ba[offset + 4]);
  }

  static readShort(ba: Uint8Array , offset: number): number {
    return (ba[offset + 1] << 8) | (ba[offset]);
  }

  static readByte(ba: Uint8Array , offset: number): number {
    return ba[offset];
  }

  static readIntBE(ba: Uint8Array , offset: number): number {
    return (ba[offset] << 24) | (ba[offset + 1] << 16) | (ba[offset + 2] << 8) | (ba[offset + 3]);
  }

  static readFloat(buf: Uint8Array , offset: number){
    const convertBuffer = new ArrayBuffer(8);
    const dataview = new DataView(convertBuffer);
    for(let i = 0; i < 4; i++){
      dataview.setUint8(i, buf[offset + i]);  
    }
    return dataview.getFloat32(0);
  }
}