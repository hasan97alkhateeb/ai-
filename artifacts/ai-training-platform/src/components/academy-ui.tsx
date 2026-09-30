import { ArrowUpRight, Check, Clock3, Flame, LockKeyhole, Play, RotateCcw, Sparkles } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'wouter';

export function Button({ children, className = '', variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'outline' | 'dark'; children: ReactNode }) {
  const styles = {
    primary: 'bg-primary text-primary-foreground shadow-[0_8px_18px_hsl(var(--primary)/.18)] hover:-translate-y-0.5 hover:shadow-[0_10px_22px_hsl(var(--primary)/.24)]',
    quiet: 'bg-muted text-foreground hover:bg-secondary',
    outline: 'border border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted',
    dark: 'bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent',
  };
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-bold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}>{children}</button>;
}

export function ProgressBar({ value, color = 'bg-primary', className = '' }: { value: number; color?: string; className?: string }) {
  return <div className={`h-2 overflow-hidden rounded-full bg-muted ${className}`}><div className={`h-full rounded-full ${color} transition-[width] duration-500 ease-out`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function CourseMark({ icon, accent, size = 'md' }: { icon: string; accent: string; size?: 'sm' | 'md' | 'lg' }) {
  const dimensions = { sm: 'h-9 w-9 text-base rounded-[10px]', md: 'h-12 w-12 text-xl rounded-[14px]', lg: 'h-16 w-16 text-2xl rounded-[18px]' };
  return <div className={`grid shrink-0 place-items-center ${dimensions[size]}`} style={{ backgroundColor: `${accent}22`, color: accent }} aria-hidden="true">{icon}</div>;
}

export function CourseCard({ course, compact = false }: { course: any; compact?: boolean }) {
  return <Link href={`/courses/${course.id}`} data-testid={`card-course-${course.id}`} className={`group block rounded-2xl border border-card-border bg-card p-5 shadow-[0_4px_18px_hsl(var(--foreground)/.035)] transition-all duration-200 hover:-translate-y-1 hover:border-primary/25 hover:shadow-[0_14px_28px_hsl(var(--foreground)/.08)] ${compact ? 'p-4' : ''}`}>
    <div className="flex items-start justify-between gap-3">
      <CourseMark icon={course.icon} accent={course.accent} size={compact ? 'sm' : 'md'} />
      {course.progressPercent > 0 ? <span className="font-mono-ui text-[10px] font-medium text-muted-foreground">{course.progressPercent}%</span> : <span className="rounded-full bg-muted px-2 py-1 font-mono-ui text-[9px] uppercase tracking-[.1em] text-muted-foreground">Start here</span>}
    </div>
    <div className={`${compact ? 'mt-4' : 'mt-5'}`}>
      <p className="font-mono-ui text-[9px] uppercase tracking-[.16em] text-muted-foreground">{course.category} · {course.level}</p>
      <h3 className={`${compact ? 'mt-1 text-[15px]' : 'mt-2 text-[18px]'} font-bold tracking-[-.02em] text-card-foreground group-hover:text-primary`}>{course.title}</h3>
      <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">{course.subtitle}</p>
    </div>
    <div className={`${compact ? 'mt-4' : 'mt-6'} flex items-center justify-between text-[11px] text-muted-foreground`}>
      <span className="flex items-center gap-1"><Clock3 size={13} /> {course.durationMinutes} min</span>
      <span className="flex items-center gap-1 font-semibold text-primary">Open <ArrowUpRight size={13} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></span>
    </div>
    {course.progressPercent > 0 && <ProgressBar value={course.progressPercent} color="bg-accent" className="mt-4 h-1.5" />}
  </Link>;
}

export function Skeleton({ className = '' }: { className?: string }) { return <div className={`animate-pulse rounded-xl bg-muted ${className}`} />; }

export function QueryState({ loading, error, onRetry, children }: { loading?: boolean; error?: boolean; onRetry?: () => void; children: ReactNode }) {
  if (loading) return <div data-testid="state-loading" className="space-y-4"><Skeleton className="h-7 w-48" /><Skeleton className="h-32 w-full" /><Skeleton className="h-24 w-full" /></div>;
  if (error) return <div data-testid="state-error" className="rounded-2xl border border-destructive/20 bg-destructive/5 px-6 py-10 text-center"><p className="font-bold text-destructive">This lesson path is temporarily dim.</p><p className="mt-2 text-sm text-muted-foreground">Try again in a moment.</p><button type="button" data-testid="button-retry" onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-destructive px-3 py-2 text-xs font-bold text-destructive-foreground"><RotateCcw size={13} /> Try again</button></div>;
  return <>{children}</>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div data-testid="state-empty" className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent/45 text-accent-foreground"><Sparkles size={20} /></div><h3 className="mt-4 font-display text-2xl">{title}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

export function LessonIcon({ complete, locked, type }: { complete: boolean; locked?: boolean; type?: string }) {
  if (complete) return <span className="grid h-8 w-8 place-items-center rounded-full bg-[#D9EBD6] text-[#3F744A]"><Check size={15} strokeWidth={2.5} /></span>;
  if (locked) return <span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground"><LockKeyhole size={14} /></span>;
  return <span className="grid h-8 w-8 place-items-center rounded-full border border-primary/25 bg-primary/5 text-primary"><Play size={13} fill="currentColor" /></span>;
}

export function Streak({ days }: { days: number }) {
  return <div className="flex items-center gap-2 rounded-full border border-accent/40 bg-accent/20 px-3 py-1.5"><Flame size={14} className="text-[#B7652B]" /><span className="font-mono-ui text-[11px] font-medium text-accent-foreground">{days} day streak</span></div>;
}