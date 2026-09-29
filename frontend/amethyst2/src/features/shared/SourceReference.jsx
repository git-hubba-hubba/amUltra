export default function SourceReference({ record }) {
  const source = record.sourceReference;
  if (!source) return null;
  return <details className="source-reference"><summary>Source: {source.file}{source.row ? ` · Row ${source.row}` : ''}</summary>
    {source.ownerLabel && <p>Source owner(s): {source.ownerLabel}</p>}
    {source.number && <p>Source Cinema number: {source.number}</p>}
    {(source.startLabel || source.dueLabel) && <p>Source dates: {source.startLabel || 'Not provided'} → {source.dueLabel || 'Not provided'}</p>}
    {source.sowReferences?.map(name => <p key={name}>Referenced SOW (not attached): {name}</p>)}
    {source.warnings?.length > 0 && <ul>{source.warnings.map((warning,index) => <li key={index}>{warning}</li>)}</ul>}
  </details>;
}
