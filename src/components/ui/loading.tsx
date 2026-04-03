"use client";

// \u2500\u2500\u2500 Spinner \u2500\u2500\u2500

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-block rounded-full border-2 border-current border-t-transparent animate-spin ${className}`}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}

// \u2500\u2500\u2500 Skeleton Card \u2500\u2500\u2500

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`bg-card rounded-xl p-4 space-y-3 ${className}`}>
      <div className="h-3 w-2/3 bg-border rounded animate-pulse" />
      <div className="h-2 w-full bg-border rounded animate-pulse" />
      <div className="h-2 w-4/5 bg-border rounded animate-pulse" />
      <div className="flex gap-2 pt-1">
        <div className="h-6 w-16 bg-border rounded-full animate-pulse" />
        <div className="h-6 w-12 bg-border rounded-full animate-pulse" />
      </div>
    </div>
  );
}

// \u2500\u2500\u2500 Skeleton List \u2500\u2500\u2500

export function SkeletonList({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 bg-card rounded-lg">
          <div className="w-8 h-8 rounded-full bg-border animate-pulse shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div
              className="h-3 bg-border rounded animate-pulse"
              style={{ width: `${60 + ((i * 17) % 30)}%` }}
            />
            <div
              className="h-2 bg-border rounded animate-pulse"
              style={{ width: `${40 + ((i * 13) % 40)}%` }}
            />
          </div>
          <div className="w-12 h-5 bg-border rounded-full animate-pulse shrink-0" />
        </div>
      ))}
    </div>
  );
}
