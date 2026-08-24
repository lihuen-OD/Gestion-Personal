type CompactBadgeListProps = {
  items: string[];
  visibleCount?: number;
  emptyLabel?: string;
};

export function CompactBadgeList({ items, visibleCount = 1, emptyLabel = "-" }: CompactBadgeListProps) {
  if (!items.length) return <span className="position-muted">{emptyLabel}</span>;
  const visible = items.slice(0, visibleCount);
  const remaining = items.length - visible.length;
  return (
    <div className="compact-badge-list" title={items.join(", ")}>
      {visible.map((item) => (
        <span key={item}>{item}</span>
      ))}
      {remaining > 0 && <span>+{remaining}</span>}
    </div>
  );
}
