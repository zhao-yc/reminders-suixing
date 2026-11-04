const WRITE_TYPES = new Set(['setCompleted', 'setText', 'createItem', 'setSchedule', 'setFlagged']);
const CODES = new Set(['IN_FLIGHT', 'WEB_STATE_OBSERVED', 'UNCHANGED', 'INVALID_COMMAND', 'READ_ONLY', 'STALE_VIEW', 'UNCERTAIN_WRITE', 'ALREADY_SUBMITTED', 'DRAFT_OPEN', 'EDIT_UNAVAILABLE', 'SCHEDULE_UNAVAILABLE', 'FLAG_UNAVAILABLE', 'CREATION_LIMIT', 'PAGE_NOT_READY', 'BUSY']);
const STAGES = new Set(['preflight', 'waiting-draft', 'writing-title', 'input-command', 'input-accepted', 'input-settled', 'leaving-editor', 'editor-left', 'awaiting-autosave', 'observing-title', 'observed', 'input-cancelled', 'input-rejected', 'editor-detached']);

function parseCreationStage(message) {
  if (typeof message !== 'string') return null;
  const match=/^suixing-create-stage:([1-9]\d{0,15}):([a-z-]{1,30})$/.exec(message);
  if (!match || !Number.isSafeInteger(Number(match[1])) || !STAGES.has(match[2])) return null;
  return {sequence:Number(match[1]),stage:match[2]};
}

/** 阶段可能晚于页面退出回执抵达；仅合并同一次本地操作的进度，绝不借迟到消息推进下一次操作。 */
function applyCreationStage(outcome, receipt) {
  if (outcome?.type !== 'createItem' || !receipt || receipt.sequence !== outcome.sequence || !STAGES.has(receipt.stage)) return outcome;
  const order=[...STAGES];
  return order.indexOf(receipt.stage) > order.indexOf(outcome.stage) ? {...outcome,stage:receipt.stage} : outcome;
}

/** 只保留写入类型、序号、固定阶段和布尔状态；不读取标题、备注、记录 ID 或快照正文。 */
function summarizeWriteOutcome(type, sequence, result, replyPending = false) {
  if (!WRITE_TYPES.has(type) || !Number.isSafeInteger(sequence) || sequence < 1) return null;
  return { type, sequence, replyPending:replyPending === true,
    code:replyPending ? 'IN_FLIGHT' : CODES.has(result?.code) ? result.code : 'OTHER',
    stage:STAGES.has(result?.stage) ? result.stage : 'unknown',
    ok:!replyPending && result?.ok === true && ['WEB_STATE_OBSERVED', 'UNCHANGED'].includes(result.code),
    dispatched:typeof result?.dispatched === 'boolean' ? result.dispatched : null, cloudConfirmed:false };
}

module.exports = { summarizeWriteOutcome, parseCreationStage, applyCreationStage };
