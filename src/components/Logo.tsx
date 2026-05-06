import { cn } from "@/lib/utils";

export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="relative grid place-items-center rounded-lg shadow-glow"
        style={{
          width: size,
          height: size,
          background: "var(--gradient-primary)",
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" width={size * 0.6} height={size * 0.6} className="text-background">
          <path d="M4 6 L12 3 L20 6 L20 14 C20 18 16 21 12 22 C8 21 4 18 4 14 Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
          <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
        </svg>
      </div>
      <span className="font-display text-lg font-semibold tracking-tight">Echo<span className="text-gradient">Pilot</span></span>
    </div>
  );
}
