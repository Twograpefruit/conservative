import type { PermissionRequest } from '@ocg/protocol';

export function PermissionCard({
  request,
  onReply,
}: {
  request: PermissionRequest;
  onReply: (decision: 'once' | 'always' | 'reject') => void;
}) {
  return (
    <div className="permission-card">
      <div className="permission-head">
        <span className="permission-badge">需要授权</span>
        <span className="permission-action">{request.action}</span>
      </div>
      <div className="permission-resources">
        {request.resources?.slice(0, 6).map((r, i) => (
          <code key={i}>{r}</code>
        ))}
        {(request.resources?.length ?? 0) > 6 ? <span>+{(request.resources?.length ?? 0) - 6}</span> : null}
      </div>
      {request.message ? <div className="permission-message">{request.message}</div> : null}
      <div className="permission-actions">
        <button className="btn btn-primary" onClick={() => onReply('once')}>
          允许一次
        </button>
        <button className="btn" onClick={() => onReply('always')} title="仅对当前会话有效">
          始终允许（本会话）
        </button>
        <button className="btn btn-danger" onClick={() => onReply('reject')}>
          拒绝
        </button>
      </div>
    </div>
  );
}
