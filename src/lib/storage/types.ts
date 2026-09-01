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
}
