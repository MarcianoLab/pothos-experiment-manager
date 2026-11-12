"use client";

import type { ExperimentState } from "./experiment";
import { workbookBytes } from "./exportWorkbook";

const DATABASE_NAME = "pothos-drive-folder";
const STORE_NAME = "handles";
export type FolderDestination = "network-folder" | "local-folder";

export type NetworkFolderConnection = { handle: WritableDirectoryHandle; path: string };

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
    showDirectoryPicker?: (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<WritableDirectoryHandle>;
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

async function storeFolderValue(destination: FolderDestination, value: WritableDirectoryHandle | NetworkFolderConnection) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, destination);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function getStoredValue(destination: FolderDestination): Promise<unknown> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(destination);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function getStoredFolder(destination: "local-folder") {
  return (await getStoredValue(destination) as WritableDirectoryHandle | undefined) ?? null;
}

export async function getStoredNetworkFolder(defaultPath: string): Promise<NetworkFolderConnection | null> {
  const stored = await getStoredValue("network-folder") as NetworkFolderConnection | WritableDirectoryHandle | undefined;
  if (!stored) return null;
  return "handle" in stored ? stored : { handle: stored, path: defaultPath };
}

async function pickWritableFolder(destination: FolderDestination) {
  if (!window.showDirectoryPicker) throw new Error("unsupported");
  const handle = await window.showDirectoryPicker({ id: `pothos-${destination}`, mode: "readwrite" });
  if (!await ensureFolderPermission(handle, true)) throw new Error("permission");
  return handle;
}

export async function chooseFolder(destination: "local-folder") {
  const handle = await pickWritableFolder(destination);
  await storeFolderValue(destination, handle);
  return handle;
}

export async function chooseNetworkFolder(path: string): Promise<NetworkFolderConnection> {
  const handle = await pickWritableFolder("network-folder");
  const connection = { handle, path };
  await storeFolderValue("network-folder", connection);
  return connection;
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
