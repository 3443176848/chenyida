import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import path from "node:path";

import {
  OpsMonitoringError,
  canonicalMonitoringJson,
  parseMonitoringJson,
  validateMonitoringState,
} from "./contract.mjs";

export const MONITORING_STATE_ROOT_MARKER = ".chenyida-erp-monitoring-state-root-v1";
export const MONITORING_STATE_ROOT_MARKER_VALUE = "chenyida-erp-monitoring-state-root/v1\n";
export const MONITORING_STATE_FILE = "current.json";
export const MONITORING_STATE_LOCK = ".monitor.lock";

function reject(code) {
  throw new OpsMonitoringError(code);
}

function owner() {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid < 0 || gid < 0) reject("MONITOR_STATE_IDENTITY_UNAVAILABLE");
  return { uid, gid };
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function safeFileText(file, expectedMode, maximumBytes) {
  const { uid, gid } = owner();
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== uid || before.gid !== gid || (before.mode & 0o7777) !== expectedMode || before.size < 1 || before.size > maximumBytes) reject("MONITOR_STATE_FILE_UNSAFE");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) reject("MONITOR_STATE_FILE_CHANGED");
    const raw = await handle.readFile("utf8");
    const after = await handle.stat();
    const pathAfter = await lstat(file);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || pathAfter.dev !== opened.dev || pathAfter.ino !== opened.ino || pathAfter.nlink !== 1 || pathAfter.uid !== uid || pathAfter.gid !== gid || (pathAfter.mode & 0o7777) !== expectedMode) reject("MONITOR_STATE_FILE_CHANGED");
    return raw;
  } finally {
    await handle.close();
  }
}

export async function validateMonitoringStateRoot(root) {
  const resolved = path.resolve(root);
  const { uid, gid } = owner();
  if (root !== resolved || resolved === path.parse(resolved).root || await realpath(resolved).catch(() => "") !== resolved) reject("MONITOR_STATE_ROOT_INVALID");
  const metadata = await lstat(resolved).catch(() => reject("MONITOR_STATE_ROOT_MISSING"));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== uid || metadata.gid !== gid || (metadata.mode & 0o7777) !== 0o700) reject("MONITOR_STATE_ROOT_UNSAFE");
  const marker = await safeFileText(path.join(resolved, MONITORING_STATE_ROOT_MARKER), 0o400, 256);
  if (marker !== MONITORING_STATE_ROOT_MARKER_VALUE) reject("MONITOR_STATE_ROOT_MARKER_INVALID");
  const entries = await readdir(resolved, { withFileTypes: true });
  for (const entry of entries) {
    if (![MONITORING_STATE_ROOT_MARKER, MONITORING_STATE_FILE, MONITORING_STATE_LOCK].includes(entry.name)) reject("MONITOR_STATE_ROOT_ENTRY_INVALID");
    if (entry.isSymbolicLink() || (entry.name === MONITORING_STATE_LOCK ? !entry.isDirectory() : !entry.isFile())) reject("MONITOR_STATE_ROOT_ENTRY_INVALID");
  }
  return resolved;
}

export async function initializeMonitoringStateRoot(root) {
  const resolved = path.resolve(root);
  const { uid, gid } = owner();
  if (root !== resolved || resolved === path.parse(resolved).root) reject("MONITOR_STATE_ROOT_INVALID");
  const parent = path.dirname(resolved);
  if (await realpath(parent).catch(() => "") !== parent) reject("MONITOR_STATE_PARENT_INVALID");
  const parentMetadata = await lstat(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || parentMetadata.uid !== uid || parentMetadata.gid !== gid || (parentMetadata.mode & 0o022) !== 0) reject("MONITOR_STATE_PARENT_UNSAFE");
  await mkdir(resolved, { mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  const metadata = await lstat(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== uid || metadata.gid !== gid || (metadata.mode & 0o7777) !== 0o700) reject("MONITOR_STATE_ROOT_UNSAFE");
  if ((await readdir(resolved)).length !== 0) reject("MONITOR_STATE_ROOT_NOT_EMPTY");
  const markerPath = path.join(resolved, MONITORING_STATE_ROOT_MARKER);
  const handle = await open(markerPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o400);
  try {
    await handle.writeFile(MONITORING_STATE_ROOT_MARKER_VALUE, "utf8");
    await handle.chmod(0o400);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(resolved);
  await validateMonitoringStateRoot(resolved);
  return resolved;
}

export async function readMonitoringState(root, config, policy) {
  const resolved = await validateMonitoringStateRoot(root);
  const file = path.join(resolved, MONITORING_STATE_FILE);
  try {
    const raw = await safeFileText(file, 0o600, 1024 * 1024);
    return validateMonitoringState(parseMonitoringJson(raw), config, policy);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof OpsMonitoringError) throw error;
    reject("MONITOR_STATE_READ_FAILED");
  }
}

async function requireLock(root) {
  const { uid, gid } = owner();
  const lock = path.join(root, MONITORING_STATE_LOCK);
  const metadata = await lstat(lock).catch(() => reject("MONITOR_STATE_LOCK_REQUIRED"));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== uid || metadata.gid !== gid || (metadata.mode & 0o7777) !== 0o700 || (await readdir(lock)).length !== 0) reject("MONITOR_STATE_LOCK_UNSAFE");
}

export async function writeMonitoringState(root, state, config, policy) {
  const resolved = await validateMonitoringStateRoot(root);
  await requireLock(resolved);
  validateMonitoringState(state, config, policy);
  const finalPath = path.join(resolved, MONITORING_STATE_FILE);
  const temporary = path.join(resolved, `.current.${process.pid}.${state.sequence}.${state.integrity_sha256}.tmp`);
  const existing = await lstat(finalPath).catch((error) => error?.code === "ENOENT" ? null : reject("MONITOR_STATE_FILE_UNSAFE"));
  const { uid, gid } = owner();
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1 || existing.uid !== uid || existing.gid !== gid || (existing.mode & 0o7777) !== 0o600)) reject("MONITOR_STATE_FILE_UNSAFE");
  const previous = await readMonitoringState(resolved, config, policy);
  if (previous) {
    if (state.sequence !== previous.sequence + 1 || state.previous_state_sha256 !== previous.integrity_sha256) reject("MONITOR_STATE_CHAIN_INVALID");
  } else if (state.sequence !== 1 || state.previous_state_sha256 !== "0".repeat(64)) reject("MONITOR_STATE_CHAIN_INVALID");
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(canonicalMonitoringJson(state), "utf8");
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await requireLock(resolved);
    await rename(temporary, finalPath);
    await syncDirectory(resolved);
    const persisted = await readMonitoringState(resolved, config, policy);
    if (!persisted || persisted.integrity_sha256 !== state.integrity_sha256) reject("MONITOR_STATE_WRITE_VERIFICATION_FAILED");
    return persisted;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function withMonitoringStateLock(root, operation) {
  const resolved = await validateMonitoringStateRoot(root);
  const lock = path.join(resolved, MONITORING_STATE_LOCK);
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") reject("MONITOR_STATE_LOCKED");
    reject("MONITOR_STATE_LOCK_CREATE_FAILED");
  }
  let operationError;
  try {
    await requireLock(resolved);
    return await operation(resolved);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await requireLock(resolved);
      await rmdir(lock);
      await syncDirectory(resolved);
    } catch {
      if (!operationError) reject("MONITOR_STATE_LOCK_CLEANUP_FAILED");
    }
  }
}
