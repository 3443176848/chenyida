"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, materialMultipart } from "../../../public/erp/api-client.js";
import { createImportWriteOperation, importFileIdentity, normalizeImportUiError, preflightImportFile, sameImportWriteRequest, type ImportWriteOperation, type MaterialImportBatch } from "../_lib/material-import";
import { MaterialImportHashWorkerController, type MaterialImportHashSnapshot } from "../_lib/material-import-hash";
import { useMaterialSession } from "./material-shell";
import { MaterialImportDialog, MaterialImportErrorState, useMaterialImportUnsavedGuard } from "./material-import-primitives";

type BatchResponse = { request_id?: string; data: MaterialImportBatch };
type UploadResponse = { request_id?: string; data: { batch: MaterialImportBatch; file: Record<string, unknown> } };
type UploadAction = "REJECT" | "ALLOW_DUPLICATE";

export function MaterialImportUploadFlow({ existingBatch }: { existingBatch?: MaterialImportBatch }) {
  const session = useMaterialSession(); const canCreate = session.user?.permissions?.includes("material.import.create") === true;
  const [hashController] = useState(() => new MaterialImportHashWorkerController());
  const fileRef = useRef<File | null>(null); const operationRef = useRef<ImportWriteOperation | null>(null);
  const [file, setFile] = useState<File | null>(null); const [preflight, setPreflight] = useState(() => preflightImportFile(null));
  const [hash, setHash] = useState<MaterialImportHashSnapshot>({ state: "IDLE", processedBytes: 0, totalBytes: 0, sha256: "", message: "" });
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState<{ loaded: number; total: number; lengthComputable: boolean } | null>(null);
  const [stage, setStage] = useState("请选择一个文件"); const [error, setError] = useState<{ code: string; message: string; requestId: string; unknown: boolean } | null>(null);
  const [duplicateBatch, setDuplicateBatch] = useState<MaterialImportBatch | null>(null); const [duplicateConfirm, setDuplicateConfirm] = useState(false);
  useMaterialImportUnsavedGuard(Boolean(file) || error?.unknown === true);
  useEffect(() => () => hashController.cancel(), [hashController]);

  if (!canCreate) return <MaterialImportErrorState title="没有新建导入权限" message="当前账号没有 material.import.create，页面不会创建批次或上传文件。" />;

  const choose = (selected: File | null) => {
    hashController.reset(); operationRef.current = null; fileRef.current = selected; setFile(selected); setProgress(null); setError(null); setDuplicateBatch(null); setDuplicateConfirm(false);
    const checked = preflightImportFile(selected); setPreflight(checked); setHash({ state: "IDLE", processedBytes: 0, totalBytes: selected?.size || 0, sha256: "", message: "" });
    if (!checked.ok || !selected) { setStage(checked.errors[0] || "请选择一个文件"); return; }
    setStage("正在计算 SHA-256"); hashController.start(selected, (snapshot) => { setHash(snapshot); if (snapshot.state === "COMPLETED") setStage("客户端预检通过"); if (snapshot.state === "FAILED") setStage("摘要计算失败"); });
  };

  const createBatch = async (retryOfBatchId: number | null): Promise<MaterialImportBatch> => {
    const payload = { source_kind: preflight.sourceKind, retry_of_batch_id: retryOfBatchId };
    let operation = operationRef.current;
    if (!operation || operation.type !== "CREATE" || !sameImportWriteRequest(operation, "POST", "/api/material-master/import-batches", payload)) operation = createImportWriteOperation({ type: "CREATE", key: crypto.randomUUID(), method: "POST", endpoint: "/api/material-master/import-batches", payload });
    operationRef.current = { ...operation, state: "PENDING" };
    const response = await api<BatchResponse>(operation.endpoint, { method: "POST", body: JSON.stringify(operation.payload), protectedWrite: { idempotencyKey: operation.key, csrfToken: session.csrf_token || "" } });
    operationRef.current = { ...operation, state: "COMPLETED" }; return response.data;
  };

  const upload = async (batch: MaterialImportBatch, action: UploadAction, reuse?: ImportWriteOperation): Promise<UploadResponse> => {
    const selected = fileRef.current; if (!selected) throw new Error("File missing");
    const payload = { batch_id: batch.id, file_identity: importFileIdentity(selected), sha256: hash.sha256, expected_version: batch.current_version, duplicate_action: action };
    const operation = reuse || createImportWriteOperation({ type: "UPLOAD", key: crypto.randomUUID(), method: "POST", endpoint: `/api/material-master/import-batches/${batch.id}/file`, payload });
    operationRef.current = { ...operation, state: "PENDING" }; setStage("正在上传"); setProgress(null);
    const response = await materialMultipart<UploadResponse>(operation.endpoint, {
      file: selected, filename: preflight.filename, protectedWrite: { idempotencyKey: operation.key, csrfToken: session.csrf_token || "" },
      headers: { "X-Expected-Version": batch.current_version, "X-File-SHA256": hash.sha256, "X-Duplicate-Action": action, "X-File-Size": selected.size },
      onProgress: (value) => { setProgress(value); setStage(value.lengthComputable && value.total > 0 && value.loaded >= value.total ? "文件已发送，正在等待服务端存储和安全检查" : "正在上传"); },
    });
    operationRef.current = { ...operation, state: "COMPLETED" }; return response;
  };

  const execute = async (action: UploadAction, retryOfBatchId: number | null = null) => {
    if (!fileRef.current || hash.state !== "COMPLETED" || busy) return; setBusy(true); setError(null);
    try {
      const batch = existingBatch && action === "REJECT" ? existingBatch : await createBatch(retryOfBatchId);
      const response = await upload(batch, action); const uploadedBatchId = response.data.batch.id;
      try { await api<UploadResponse>(`/api/material-master/import-batches/${uploadedBatchId}`, { cache: "no-store" }); }
      catch { /* 上传已有权威成功响应；进入工作区后由共享读取流程继续恢复。 */ }
      fileRef.current = null; setFile(null); setStage("文件服务端检查已完成"); window.location.assign(`/materials/imports/${uploadedBatchId}?view=parse&row_page=1&row_page_size=50`);
    } catch (reason) {
      const normalized = normalizeImportUiError(reason);
      if (normalized.code === "IMPORT_FILE_DUPLICATE") {
        const id = existingBatch?.id || Number((operationRef.current?.payload as { batch_id?: number })?.batch_id || 0);
        try { const detail = await api<UploadResponse>(`/api/material-master/import-batches/${id}`, { cache: "no-store" }); setDuplicateBatch(detail.data.batch); } catch { /* keep safe duplicate message only */ }
        setError({ code: normalized.code, message: "重复文件，上传未完成。原批次已失败；允许重复时会新建重试批次。", requestId: normalized.requestId, unknown: false });
      } else {
        const unknown = normalized.resultUnknown; if (unknown && operationRef.current) operationRef.current = { ...operationRef.current, state: "RESULT_UNKNOWN" };
        setError({ code: normalized.code, message: unknown ? "操作结果尚未确认，只能使用原操作标识和原载荷安全恢复。" : normalized.message, requestId: normalized.requestId, unknown });
      }
    } finally { setBusy(false); setConfirm(false); setDuplicateConfirm(false); }
  };

  const recoverUnknown = async () => {
    const operation = operationRef.current; if (!operation || operation.state !== "RESULT_UNKNOWN" || busy) return; setBusy(true); setError(null);
    try {
      if (operation.type === "CREATE") {
        const response = await api<BatchResponse>(operation.endpoint, { method: "POST", body: JSON.stringify(operation.payload), protectedWrite: { idempotencyKey: operation.key, csrfToken: session.csrf_token || "" } });
        operationRef.current = null; const uploaded = await upload(response.data, "REJECT"); window.location.assign(`/materials/imports/${uploaded.data.batch.id}?view=parse&row_page=1&row_page_size=50`);
      } else if (operation.type === "UPLOAD") {
        const payload = operation.payload as { batch_id: number; expected_version: number; duplicate_action: UploadAction };
        const batch = { id: payload.batch_id, current_version: payload.expected_version } as MaterialImportBatch; const uploaded = await upload(batch, payload.duplicate_action, operation);
        window.location.assign(`/materials/imports/${uploaded.data.batch.id}?view=parse&row_page=1&row_page_size=50`);
      }
    } catch (reason) {
      const normalized = normalizeImportUiError(reason); if (normalized.resultUnknown && operationRef.current) operationRef.current = { ...operationRef.current, state: "RESULT_UNKNOWN" };
      setError({ code: normalized.code, message: normalized.resultUnknown ? "操作结果仍未确认；没有生成新 Key。" : normalized.message, requestId: normalized.requestId, unknown: normalized.resultUnknown });
    } finally { setBusy(false); }
  };

  const percentage = hash.totalBytes ? Math.floor(hash.processedBytes / hash.totalBytes * 100) : 0;
  return <section className="mi-upload-flow">
    <div className="mi-upload-card"><label htmlFor="material-import-file">选择单个文件</label><input id="material-import-file" type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={(event) => choose(event.currentTarget.files?.length === 1 ? event.currentTarget.files[0] : null)} />
      <p>支持 .xlsx、.xls 或 .csv，文件非空且不超过 10 MiB。客户端预检不代表文件安全或服务端必然接受。</p>
      {file ? <dl className="mi-file-facts"><div><dt>文件名</dt><dd>{preflight.filename}</dd></div><div><dt>大小</dt><dd>{file.size.toLocaleString()} 字节</dd></div><div><dt>MIME</dt><dd>{file.type || "浏览器未报告"}</dd></div></dl> : null}
      {preflight.errors.length ? <ul className="mi-issues" role="alert">{preflight.errors.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      {hash.state === "HASHING" ? <div className="mi-progress" role="status" aria-live="polite"><progress max={hash.totalBytes} value={hash.processedBytes} /><span>SHA-256：{hash.processedBytes.toLocaleString()} / {hash.totalBytes.toLocaleString()} 字节（{percentage}%）</span></div> : null}
      {hash.state === "COMPLETED" ? <p className="mi-success" role="status">客户端预检通过；SHA-256 已计算。服务端仍会独立核验。</p> : null}
      {hash.state === "FAILED" ? <p role="alert">{hash.message}</p> : null}
      {progress ? <div className="mi-progress" role="status"><progress max={progress.lengthComputable ? progress.total : undefined} value={progress.lengthComputable ? progress.loaded : undefined} /><span>{stage}{progress.lengthComputable ? `：${Math.floor(progress.loaded / progress.total * 100)}%（仅网络发送）` : ""}</span></div> : <p className="mi-stage" aria-live="polite">{stage}</p>}
      <button className="mi-primary" disabled={busy || hash.state !== "COMPLETED"} onClick={() => setConfirm(true)}>{existingBatch ? "确认并上传到当前批次" : "确认并创建批次"}</button>
    </div>
    {error ? <div className={`mi-operation-error ${error.unknown ? "unknown" : ""}`} role="alert"><strong>{error.code}</strong><p>{error.message}</p>{error.requestId ? <p className="mm-request-id">请求编号：{error.requestId}</p> : null}{error.unknown ? <button disabled={busy} onClick={() => void recoverUnknown()}>使用原操作标识安全恢复</button> : null}{error.code === "IMPORT_FILE_DUPLICATE" && duplicateBatch ? <button onClick={() => setDuplicateConfirm(true)}>允许重复并新建重试批次</button> : null}</div> : null}
    {confirm ? <MaterialImportDialog title={existingBatch ? "确认上传文件" : "确认创建导入批次"} busy={busy} primaryLabel={existingBatch ? "上传文件" : "创建并上传"} onClose={() => setConfirm(false)} onPrimary={() => void execute("REJECT")}><p>将先创建或使用一个批次，再以默认 REJECT 策略上传。文件安全和内容合法性仍由服务端判断。</p></MaterialImportDialog> : null}
    {duplicateConfirm && duplicateBatch ? <MaterialImportDialog title="允许重复并新建重试批次" busy={busy} primaryLabel="新建重试批次" onClose={() => setDuplicateConfirm(false)} onPrimary={() => void execute("ALLOW_DUPLICATE", duplicateBatch.id)}><p>原批次保持 FAILED。系统会核对当前 File SHA，新建 retry_of_batch_id 指向原批次的批次，并使用新的创建和上传操作标识。</p></MaterialImportDialog> : null}
  </section>;
}

export function MaterialImportCreatePage() {
  return <section className="mi-create-page"><div className="mm-breadcrumb"><Link href="/materials">物料主数据</Link><span>/</span><Link href="/materials/imports">导入批次</Link><span>/</span><span>新建</span></div><header className="mm-page-head"><div><h2>新建物料导入批次</h2><p>选择文件、客户端预检、计算 SHA-256，再确认创建和上传。</p></div></header><MaterialImportUploadFlow /></section>;
}
