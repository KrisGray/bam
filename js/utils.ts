export default class Utils {
  static shallowCopy(o: any): any {
    const n: any = {};
    for (var k in o) {
      n[k] = o[k];
    }
    return n;
  }
}