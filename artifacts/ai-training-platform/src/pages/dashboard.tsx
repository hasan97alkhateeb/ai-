import { ArrowRight, BookOpen, CheckCircle2, Flame, Lightbulb, Play, Target } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'wouter';
import { useGetDashboard, useListActivity } from '@workspace/api-client-react';
import { AcademyShell } from '@/components/academy-shell';
import { CourseCard, EmptyState, ProgressBar, QueryState, Streak } from '@/components/academy-ui';

export default function DashboardPage() {
  const dashboard = useGetDashboard();
  const activity = useListActivity();
  const learner = dashboard.data?.learner;
  const stats = dashboard.data?.stats;
  const inProgress = dashboard.data?.inProgress ?? [];
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  }, []);

  return <AcademyShell learnerName={learner?.name} learnerLevel={learner?.level}>
    <QueryState loading={dashboard.isLoading} error={dashboard.isError} onRetry={() => dashboard.refetch()}>
      <div className="space-y-9">
        <section className="lumen-rise flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="font-mono-ui text-[10px] uppercase tracking-[.22em] text-primary">Your learning space</p>
            <h1 data-testid="heading-dashboard" className="mt-3 max-w-xl text-balance font-display text-[42px] leading-[.98] tracking-[-.035em] text-foreground sm:text-[54px]">{greeting}, {learner?.name?.split(' ')[0] ?? 'learner'}.</h1>
            <p className="mt-4 max-w-lg text-[14px] leading-relaxed text-muted-foreground">A little progress today gives tomorrow something to build on.</p>
          </div>
          <Streak days={learner?.streakDays ?? 0} />
        </section>

        <section className="lumen-rise lumen-rise-delay-1 grid gap-4 md:grid-cols-[1.35fr_.65fr]">
          <div className="relative overflow-hidden rounded-2xl bg-sidebar p-6 text-sidebar-foreground sm:p-8">
            <div className="absolute -right-12 -top-20 h-56 w-56 rounded-full border border-sidebar-primary/20" />
            <div className="absolute -right-2 -top-10 h-36 w-36 rounded-full border border-sidebar-primary/15" />
            <div className="relative">
              <div className="flex items-center justify-between gap-5">
                <div>
                  <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-sidebar-primary">Weekly signal</p>
                  <h2 className="mt-3 font-display text-[30px] leading-none sm:text-[36px]">Keep the thread.</h2>
                </div>
                <div className="hidden h-20 w-20 shrink-0 place-items-center rounded-full border-4 border-sidebar-primary/25 sm:grid" style={{ background: `conic-gradient(hsl(var(--sidebar-primary)) ${(stats?.completionPercent ?? 0) * 3.6}deg, hsl(var(--sidebar-accent)) 0)` }}>
                  <div className="grid h-[58px] w-[58px] place-items-center rounded-full bg-sidebar text-center"><span className="font-mono-ui text-sm text-sidebar-primary">{stats?.completionPercent ?? 0}%</span></div>
                </div>
              </div>
              <p className="mt-5 max-w-md text-[13px] leading-relaxed text-sidebar-foreground/65">You’ve spent <span className="font-semibold text-sidebar-foreground">{stats?.weeklyMinutes ?? 0} minutes</span> learning this week. One focused lesson is enough to move the line.</p>
              <Link href={inProgress[0] ? `/courses/${inProgress[0].id}` : '/courses'} data-testid="link-continue-learning" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-sidebar-primary px-4 py-2.5 text-[12px] font-bold text-sidebar-primary-foreground transition-transform hover:-translate-y-0.5">{inProgress[0] ? 'Continue learning' : 'Browse courses'} <ArrowRight size={14} /></Link>
            </div>
          </div>
          <div className="rounded-2xl border border-card-border bg-card p-6">
            <div className="flex items-center justify-between"><span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary"><Target size={17} /></span><span className="font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">All time</span></div>
            <p className="mt-8 font-mono-ui text-[34px] leading-none tracking-[-.04em] text-card-foreground">{stats?.completedLessons ?? 0}<span className="text-lg text-muted-foreground">/{stats?.totalLessons ?? 0}</span></p>
            <p className="mt-2 text-[13px] font-semibold">lessons completed</p>
            <ProgressBar value={stats?.completionPercent ?? 0} color="bg-accent" className="mt-5" />
            <p className="mt-2 text-right font-mono-ui text-[10px] text-muted-foreground">{stats?.completionPercent ?? 0}% of your path</p>
          </div>
        </section>

        <section className="lumen-rise lumen-rise-delay-2 grid gap-9 lg:grid-cols-[1.5fr_.8fr]">
          <div>
            <div className="mb-4 flex items-end justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">In motion</p><h2 className="mt-2 text-[22px] font-bold tracking-[-.025em]">Active learning</h2></div><Link href="/courses" data-testid="link-view-all-courses" className="flex items-center gap-1 text-[12px] font-bold text-primary hover:underline">View library <ArrowRight size={13} /></Link></div>
            {inProgress.length ? <div className="grid gap-3 sm:grid-cols-2">{inProgress.slice(0, 2).map((course) => <CourseCard key={course.id} course={course} compact />)}</div> : <EmptyState title="Your path starts here" description="Choose a short course and make your first useful connection." action={<Link href="/courses" data-testid="link-empty-browse" className="inline-flex rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground">Browse course library</Link>} />}
          </div>

          <div>
            <div className="mb-4 flex items-end justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">The paper trail</p><h2 className="mt-2 text-[22px] font-bold tracking-[-.025em]">Recent activity</h2></div></div>
            <div className="rounded-2xl border border-card-border bg-card px-5 py-2">
              {activity.isLoading ? <div className="space-y-4 py-5"><div className="h-10 animate-pulse rounded bg-muted" /><div className="h-10 animate-pulse rounded bg-muted" /></div> : activity.data?.length ? activity.data.slice(0, 4).map((item, index) => <div key={item.id} data-testid={`activity-item-${item.id}`} className="flex gap-3 border-b border-border/70 py-4 last:border-0"><div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${index === 0 ? 'bg-accent/35 text-[#9B5C25]' : 'bg-secondary text-primary'}`}>{item.type === 'lesson' ? <BookOpen size={13} /> : item.type === 'streak' ? <Flame size={13} /> : <CheckCircle2 size={13} />}</div><div className="min-w-0"><p className="truncate text-[12px] font-bold">{item.title}</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.description}</p></div></div>) : <p className="py-8 text-center text-xs text-muted-foreground">Your next milestone will show up here.</p>}
            </div>
          </div>
        </section>

        <section className="lumen-rise lumen-rise-delay-3 grid gap-4 rounded-2xl border border-border bg-secondary/40 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
          <div className="flex gap-4"><div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground"><Lightbulb size={18} /></div><div><p className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground">A useful nudge</p><p className="mt-1 text-sm font-semibold">Practice turns “I’ve seen this” into “I can do this.”</p></div></div>
          <Link href="/practice" data-testid="link-nudge-practice" className="inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline">Try a practice set <Play size={13} /></Link>
        </section>
      </div>
    </QueryState>
  </AcademyShell>;
}