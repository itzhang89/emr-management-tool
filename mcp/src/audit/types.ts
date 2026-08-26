export interface AuditEntry {
  id: string;
  timestamp: string;
  tool: string;
  args: Record<string, unknown>;
  resultPreview: {
    sizeChars: number;
    candidateCauses?: string[];
    sanitized: boolean;
  };
  duration: number;
  error: string | null;
}

export interface AuditEntryWithRaw extends AuditEntry {
  rawText?: string;
}

export interface AuditStore {
  write(entry: AuditEntry, rawText?: string): Promise<void>;
  get(id: string): Promise<AuditEntryWithRaw | null>;
  getRawPath(id: string): string;
}