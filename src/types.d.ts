// Module declarations for imports that TypeScript doesn't recognize

declare module '*.wgsl?raw' {
  const content: string;
  export default content;
}

declare module '*.wgsl' {
  const content: string;
  export default content;
}

// Float16Array is available in Chrome but TypeScript doesn't know about it yet
declare global {
  const Float16Array: {
    new(length: number): any;
    new(array: ArrayLike<number>): any;
    new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): any;
    from(array: ArrayLike<number>): any;
  };
}
