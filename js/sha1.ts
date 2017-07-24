/*
 * A JavaScript implementation of the Secure Hash Algorithm, SHA-1, as defined
 * in FIPS 180-1
 * Version 3.0 Copyright Kristian Gray 2017.
 * Other contributors: Paul Johnston, Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for details.
 */

export default class SHA1 {
  /*
  * Configurable variables. You may need to tweak these to be compatible with
  * the server-side, but the defaults work in most cases.
  */
  static b64pad = ''; /* base-64 pad character. "=" for strict RFC compliance   */
  private _query: string;
  private _b64_sha1: string;

  constructor(input: string) {
    this._query = input;
    this._b64_sha1 = SHA1.rstr2b64(
      SHA1.rstr_sha1(
        SHA1.str2rstr_utf8(this._query)
      )
    );
  }

  get b64_sha1(): string {
    return this._b64_sha1;
  }

  /*
  * Convert a raw string to a base-64 string
  */
  static rstr2b64(input: string) {
    // try { b64pad } catch(e) { b64pad=''; }
    var tab = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var output = "";
    var len = input.length;
    for (var i = 0; i < len; i += 3) {
      var triplet = (input.charCodeAt(i) << 16)
        | (i + 1 < len ? input.charCodeAt(i + 1) << 8 : 0)
        | (i + 2 < len ? input.charCodeAt(i + 2) : 0);
      for (var j = 0; j < 4; j++) {
        if (i * 8 + j * 6 > input.length * 8) output += SHA1.b64pad;
        else output += tab.charAt((triplet >>> 6 * (3 - j)) & 0x3F);
      }
    }
    return output;
  }

  /*
  * Encode a string as utf-8.
  * For efficiency, this assumes the input is valid utf-16.
  */
  static str2rstr_utf8(input: string): string {
    let output = '';
    let i = -1;
    let x, y;

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
        output += String.fromCharCode(0xC0 | ((x >>> 6) & 0x1F),
          0x80 | (x & 0x3F));
      else if (x <= 0xFFFF)
        output += String.fromCharCode(0xE0 | ((x >>> 12) & 0x0F),
          0x80 | ((x >>> 6) & 0x3F),
          0x80 | (x & 0x3F));
      else if (x <= 0x1FFFFF)
        output += String.fromCharCode(0xF0 | ((x >>> 18) & 0x07),
          0x80 | ((x >>> 12) & 0x3F),
          0x80 | ((x >>> 6) & 0x3F),
          0x80 | (x & 0x3F));
    }
    return output;
  }

  /*
  * Calculate the SHA1 of a raw string
  */
  static rstr_sha1(rstr: string): string {
    return SHA1.binb2rstr(
      SHA1.binb_sha1(
        SHA1.rstr2binb(rstr),
        rstr.length * 8
      )
    );
  }
  
  /*
  * Convert a raw string to an array of big-endian words
  * Characters >255 have their high-byte silently ignored.
  */
  static rstr2binb(rstr: string): number[] {
    let binb = new Array(rstr.length >> 2);
    for (let i = 0; i < binb.length; i++) {
      binb[i] = 0;
    }
    for (let i = 0; i < rstr.length * 8; i += 8) {
      binb[i >> 5] |= (rstr.charCodeAt(i / 8) & 0xFF) << (24 - i % 32);
    }
    return binb;
  }
  
  /*
  * Calculate the SHA-1 of an array of big-endian words, and a bit length
  */
  static binb_sha1(binb: number[], len: number): number[] {
    /* append padding */
    binb[len >> 5] |= 0x80 << (24 - len % 32);
    binb[((len + 64 >> 9) << 4) + 15] = len;

    let w = new Array(80);
    let a = 1732584193;
    let b = -271733879;
    let c = -1732584194;
    let d = 271733878;
    let e = -1009589776;

    for (let i = 0; i < binb.length; i += 16) {
      const olda = a;
      const oldb = b;
      const oldc = c;
      const oldd = d;
      const olde = e;

      for (let j = 0; j < 80; j++) {
        if (j < 16){
          w[j] = binb[i + j];
        }
        else {
          w[j] = SHA1.bit_rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
        }
        const t = SHA1.safe_add(
          SHA1.safe_add(SHA1.bit_rol(a, 5),
          SHA1.sha1_ft(j, b, c, d)),
          SHA1.safe_add(
            SHA1.safe_add(e, w[j]),
            SHA1.sha1_kt(j)
          )
        );
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
  }

  /*
  * Determine the appropriate additive constant for the current iteration
  */
  static sha1_kt(t: number): number {
    return (t < 20) ? 1518500249 : (t < 40) ? 1859775393 :
      (t < 60) ? -1894007588 : -899497514;
  }

  /*
  * Perform the appropriate triplet combination function for the current
  * iteration
  */
  static sha1_ft(t: number, b: number, c: number, d: number): number {
    if (t < 20) return (b & c) | ((~b) & d);
    if (t < 40) return b ^ c ^ d;
    if (t < 60) return (b & c) | (b & d) | (c & d);
    return b ^ c ^ d;
  }

  /*
  * Add integers, wrapping at 2^32. This uses 16-bit operations internally
  * to work around bugs in some JS interpreters.
  */
  static safe_add(x: number, y: number): number {
    var lsw = (x & 0xFFFF) + (y & 0xFFFF);
    var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xFFFF);
  }

  /*
  * Bitwise rotate a 32-bit number to the left.
  */
  static bit_rol(num: number, cnt: number): number {
    return (num << cnt) | (num >>> (32 - cnt));
  }

  /*
  * Convert an array of big-endian words to a string
  */
  static binb2rstr(input: number[]): string {
    var output = "";
    for (var i = 0; i < input.length * 32; i += 8)
      output += String.fromCharCode((input[i >> 5] >>> (24 - i % 32)) & 0xFF);
    return output;
  }
}