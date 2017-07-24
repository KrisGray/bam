import Vob from "./vob";

export default class Chunk {
  minv: Vob;
  maxv: Vob;

  constructor(minv: Vob, maxv: Vob){
    this.maxv = maxv;
    this.minv = minv;  
  }

}