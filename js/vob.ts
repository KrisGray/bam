export default class Vob {
  offset: number;
  block: number;
  
  constructor(b: number, o: number) {
    this.block = b;
    this.offset = o;
  }

  toString(): string {
    return '' + this.block + ':' + this.offset;
  }

  static factory(ba: Uint8Array, offset: number): Vob {
    var block = ((ba[offset+6] & 0xff) * 0x100000000) + ((ba[offset+5] & 0xff) * 0x1000000) + ((ba[offset+4] & 0xff) * 0x10000) + ((ba[offset+3] & 0xff) * 0x100) + ((ba[offset+2] & 0xff));
    var bint = (ba[offset+1] << 8) | (ba[offset]);
    if (block == 0 && bint == 0) {
        return null;  // Should only happen in the linear index?
    } else {
        return new Vob(block, bint);
    }
  }
}




