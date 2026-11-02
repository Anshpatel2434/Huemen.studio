export interface PutResult {
  key: string;
  bytes: number;
}

export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Uint8Array, mime: string): Promise<PutResult>;
  get(key: string): Promise<{ data: Uint8Array; mime: string } | null>;
  /** Short-lived, scoped URL for reading the object (INV-1). */
  signedUrl(key: string, ttlSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
  /**
   * A one-time address the browser can PUT exactly `bytes` bytes of `mime` to
   * (./upload). Drivers without one (local disk) are written through the app.
   */
  presignPut?(key: string, bytes: number, mime: string, ttlSeconds: number): Promise<string>;
}
