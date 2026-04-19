
interface SkeletonProps { width?: number | string; height?: number | string; className?: string }

export function Skeleton({ width, height = 12, className = '' }: SkeletonProps) {
  return (
    <div
      className={`rounded bg-bg-surface2 animate-shimmer ${className}`}
      style={{
        width: width ?? '100%',
        height,
        backgroundImage: 'linear-gradient(90deg, #18132e 0%, #2a2050 50%, #18132e 100%)',
        backgroundSize: '200% 100%',
      }}
    />
  )
}

export function SkeletonRow() {
  return (
    <div className="grid items-center px-4 py-3 border-b border-border-subtle" style={{ gridTemplateColumns: '1fr 120px 80px 70px 80px' }}>
      <div className="flex flex-col gap-1.5"><Skeleton height={11} className="w-2/3" /><Skeleton height={9} className="w-1/3" /></div>
      <Skeleton height={10} className="w-3/4" />
      <Skeleton height={10} className="w-2/3" />
      <Skeleton height={10} className="w-1/2" />
      <Skeleton height={18} className="w-14 rounded-full" />
    </div>
  )
}

export default Skeleton
