"use client";

import type { ExperimentState } from "./experiment";
import { workbookBytes } from "./exportWorkbook";

const DATABASE_NAME = "pothos-drive-folder";
const STORE_NAME = "handles";
export type FolderDestination = "drive-folder" | "local-folder";

type PermissionStateValue = "granted" | "denied" | "prompt";

export type WritableDirectoryHandle = {
  name: string;
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionStateValue>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionStateValue>;
  getFileHandle(name: string, options: { create: boolean }): Promise<{
    createWritable(): Promise<{
      write(data: ArrayBuffer): Promise<void>;
      close(): Promise<void>;
    }>;
  }>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<WritableDirectoryHandle>;
  }
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeHandle(handle: WritableDirectoryHandle, destination: FolderDestination) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(handle, destination);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function getStoredFolder(destination: FolderDestination) {
  const database = await openDatabase();
  const handle = await new Promise<WritableDirectoryHandle | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(destination);
    request.onsuccess = () => resolve((request.result as WritableDirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return handle;
}

export async function chooseFolder(destination: FolderDestination) {
  if (!window.showDirectoryPicker) throw new Error("unsupported");
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  const permission = await handle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") throw new Error("permission");
  await storeHandle(handle, destination);
  return handle;
}

export async function ensureFolderPermission(handle: WritableDirectoryHandle, request = false) {
  const current = await handle.queryPermission({ mode: "readwrite" });
  if (current === "granted") return true;
  if (!request) return false;
  return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
}

export async function syncWorkbookToFolder(state: ExperimentState, handle: WritableDirectoryHandle) {
  const file = await handle.getFileHandle(`${state.sessionCode}.xlsx`, { create: true });
  const writable = await file.createWritable();
  await writable.write(await workbookBytes(state));
  await writable.close();
}
