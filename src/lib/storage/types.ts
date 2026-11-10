export interface PutResult {
  key: string;
  bytes: number;
}

export interface StoredObject {
  key: string;
  /** When the object was last written. */
  modified: Date;
}

export interface Listing {
  objects: StoredObject[];
  /** With a delimiter: the "folders" one level under the prefix, each ending in "/". */
  prefixes: string[];
}

export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Uint8Array, mime: string): Promise<PutResult>;
  get(key: string): Promise<{ data: Uint8Array; mime: string } | null>;
  /** Short-lived, scoped URL for reading the object (INV-1). */
  signedUrl(key: string, ttlSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
  /**
   * Every object under a folder prefix (ending in "/"), all pages. With
   * `delimiter: "/"`, only the objects directly in it, plus its sub-folders
   * in `prefixes`. For housekeeping (./sweep), not for serving requests.
   */
  list(prefix: string, opts?: { delimiter?: "/" }): Promise<Listing>;
  /**
   * A one-time address the browser can PUT exactly `bytes` bytes of `mime` to
   * (./upload). Drivers without one (local disk) are written through the app.
   */
  presignPut?(key: string, bytes: number, mime: string, ttlSeconds: number): Promise<string>;
}
