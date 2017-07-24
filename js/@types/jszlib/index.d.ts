declare module 'jszlib' {
  export function inflateBuffer(buffer: ArrayBuffer, start: number, length: number, afterUncOffset: number[]): ArrayBuffer;
  export function arrayCopy(src: ArrayBuffer, srcOffset: number, dest: ArrayBuffer, destOffset: number, count: number): void;
}