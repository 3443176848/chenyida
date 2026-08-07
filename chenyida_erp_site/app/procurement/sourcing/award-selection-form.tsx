"use client";

import type { FormEvent } from "react";
import {
  awardCandidateOptionLabel,
  awardCandidatesForRfqLine,
  awardReasonLabels,
  canonicalStableId,
  type AwardCandidateDetail,
} from "./award-candidate-selection";

export function AwardSelectionForm({
  detail,
  busy,
  onReview,
}: {
  detail: AwardCandidateDetail;
  busy: boolean;
  onReview: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const version = detail.comparison_read_model.current_version;
  if (!version || version.status !== "CURRENT" || !version.awardable_now) {
    return <div className="sourcing-state">当前 Comparison 不是可定标的 CURRENT Version，请先核对输入漂移或重新生成比价。</div>;
  }
  return <form className="sourcing-form award-selection-form" onSubmit={onReview}>
    <p className="award-form-note">选择 Candidate 只形成待确认草稿；打开正式确认窗口前不会发送 business POST。最低价不等于自动获选。</p>
    <label>总体理由代码
      <select name="reason_code" required defaultValue="">
        <option value="">请选择</option>
        {Object.entries(awardReasonLabels).map(([value, label]) => <option key={value} value={value}>{value} / {label}</option>)}
      </select>
    </label>
    <label>完整理由<textarea name="reason" required maxLength={1000}/></label>
    {detail.lines.map((line) => {
      const rfqLineId = canonicalStableId(line.id, "RFQ Line ID");
      const candidates = awardCandidatesForRfqLine(detail.comparison_read_model, rfqLineId);
      return <fieldset className="award-candidate-fieldset" key={rfqLineId} data-rfq-line-id={rfqLineId}>
        <legend>RFQ Line {line.line_no} · Material {line.material_id ?? "—"} / {line.internal_material_code}</legend>
        <label>选择 CURRENT Comparison Candidate
          <select className="award-candidate-select" name={`candidate_${rfqLineId}`} required defaultValue="" data-candidate-count={candidates.length}>
            <option value="">请选择</option>
            {candidates.map((candidate) => <option
              value={canonicalStableId(candidate.comparison_candidate_id, "Candidate ID")}
              key={canonicalStableId(candidate.comparison_candidate_id, "Candidate ID")}
            >{awardCandidateOptionLabel(candidate)}</option>)}
          </select>
        </label>
        <label>逐行选型补充（可选）<textarea name={`selection_reason_${rfqLineId}`} maxLength={1000}/></label>
        <label>晚交期接受代码
          <select name={`late_code_${rfqLineId}`} defaultValue="">
            <option value="">不适用</option>
            <option value="LATE_DELIVERY_ACCEPTED">LATE_DELIVERY_ACCEPTED / 接受延期交付</option>
          </select>
        </label>
        <label>晚交期接受理由<textarea name={`late_reason_${rfqLineId}`} maxLength={1000}/></label>
        <label>超申请数量原因<textarea name={`excess_reason_${rfqLineId}`} maxLength={1000}/></label>
      </fieldset>;
    })}
    <button disabled={busy}>打开正式定标确认窗口</button>
  </form>;
}
