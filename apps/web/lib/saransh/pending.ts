import { safeStorage } from "@/lib/storage";

/** A document attached from the hero before a session exists; carried to Parakh via ?doc= and this cache. */
export interface PendingDocument {
  id: string;
  fileName: string;
}

const KEY = "nyay.pendingDocuments";

export function rememberDocument(doc: PendingDocument): void {
  const all = safeStorage.get<Record<string, string>>(KEY) ?? {};
  all[doc.id] = doc.fileName;
  safeStorage.set(KEY, all);
}

export function recallDocument(id: string | null | undefined): PendingDocument | null {
  if (!id) return null;
  const fileName = safeStorage.get<Record<string, string>>(KEY)?.[id];
  return fileName ? { id, fileName } : null;
}
