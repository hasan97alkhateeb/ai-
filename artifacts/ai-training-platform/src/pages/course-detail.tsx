import { ArrowLeft, ArrowRight, Check, CircleHelp, Clock3, FileText, Headphones, LockKeyhole, PlayCircle, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import { getGetCourseQueryKey, getGetDashboardQueryKey, getListActivityQueryKey, useGetCourse, useUpdateCourseProgress } from '@workspace/api-client-react';
import { AcademyShell } from '@/components/academy-shell';
import { Button, CourseMark, LessonIcon, ProgressBar, QueryState } from '@/components/academy-ui';

const typeIcons: Record<string, typeof FileText> = { lesson: FileText, exercise: PlayCircle, reflection: CircleHelp, audio: Headphones };

export default function CourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const courseId = params.courseId ?? '';
  const course = useGetCourse(courseId, { query: { queryKey: getGetCourseQueryKey(courseId) } });
  const progress = useUpdateCourseProgress();
  const lessons = useMemo(() => course.data?.lessons ?? [], [course.data?.lessons]);
  const completed = lessons.filter((lesson) => lesson.completed).length;
  const nextLesson = lessons.find((lesson) => !lesson.completed);

  const toggleLesson = (lessonId: string, completedState: boolean) => {
    progress.mutate({ courseId, data: { lessonId, completed: completedState } }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetCourseQueryKey(courseId), (old: any) => old ? { ...old, completedLessons: updated.completedLessons, progressPercent: updated.progressPercent, lessons: old.lessons.map((item: any) => item.id === lessonId ? { ...item, completed: completedState } : item) } : old);
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListActivityQueryKey() });
      },
    });
  };

  return <AcademyShell>
    <QueryState loading={course.isLoading} error={course.isError} onRetry={() => course.refetch()}>
      {course.data && <div className="space-y-8">
        <Link href="/courses" data-testid="link-back-courses" className="inline-flex items-center gap-2 text-[12px] font-semibold text-muted-foreground hover:text-primary"><ArrowLeft size={14} /> Course library</Link>
        <section className="relative overflow-hidden rounded-2xl bg-sidebar p-6 text-sidebar-foreground sm:p-9">
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full border border-sidebar-primary/20" />
          <div className="relative grid gap-8 lg:grid-cols-[1fr_250px] lg:items-end">
            <div><div className="flex items-center gap-3"><CourseMark icon={course.data.icon} accent={course.data.accent} size="lg" /><div><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-sidebar-primary">{course.data.category} · {course.data.level}</p><p className="mt-1 text-[11px] text-sidebar-foreground/55">{course.data.lessonCount} lessons · {course.data.durationMinutes} minutes</p></div></div><h1 data-testid="heading-course-detail" className="mt-7 max-w-2xl font-display text-[39px] leading-[.98] tracking-[-.03em] sm:text-[52px]">{course.data.title}</h1><p className="mt-4 max-w-xl text-[13px] leading-relaxed text-sidebar-foreground/65">{course.data.description}</p><div className="mt-5 flex flex-wrap gap-2">{course.data.tags.map((tag) => <span key={tag} className="rounded-full border border-sidebar-border px-2.5 py-1 font-mono-ui text-[9px] text-sidebar-foreground/65">{tag}</span>)}</div></div>
            <div className="rounded-2xl border border-sidebar-border bg-sidebar-accent/55 p-5"><div className="flex items-center justify-between"><span className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-sidebar-foreground/55">Your progress</span><span className="font-mono-ui text-sm text-sidebar-primary">{course.data.progressPercent}%</span></div><ProgressBar value={course.data.progressPercent} color="bg-sidebar-primary" className="mt-4 bg-sidebar-border" /><p className="mt-3 text-[11px] text-sidebar-foreground/55">{completed} of {lessons.length} lessons completed</p>{nextLesson && <Button type="button" variant="primary" onClick={() => document.getElementById(`lesson-${nextLesson.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="mt-5 w-full bg-sidebar-primary text-sidebar-primary-foreground">{completed ? 'Resume lesson' : 'Begin course'} <ArrowRight size={14} /></Button>}{!nextLesson && <div className="mt-5 flex items-center gap-2 text-xs font-bold text-sidebar-primary"><Check size={15} /> Path complete</div>}</div>
          </div>
        </section>

        <section className="grid gap-8 lg:grid-cols-[1fr_280px]">
          <div><div className="mb-4 flex items-end justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">The sequence</p><h2 className="mt-2 text-[23px] font-bold tracking-[-.025em]">Course lessons</h2></div><span className="font-mono-ui text-[11px] text-muted-foreground">{completed}/{lessons.length} done</span></div><div className="relative space-y-2">{lessons.map((lesson, index) => { const Icon = typeIcons[lesson.type] ?? FileText; const locked = index > 0 && !lessons[index - 1].completed && !lesson.completed; return <div key={lesson.id} id={`lesson-${lesson.id}`} data-testid={`lesson-row-${lesson.id}`} className={`group flex items-center gap-4 rounded-2xl border p-4 transition-colors ${lesson.completed ? 'border-[#CDE2CA] bg-[#F3F8F1]' : locked ? 'border-border/70 bg-muted/35 opacity-70' : 'border-card-border bg-card hover:border-primary/30'}`}><LessonIcon complete={lesson.completed} locked={locked} type={lesson.type} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-muted-foreground">0{index + 1} · {lesson.type}</span>{lesson.completed && <span className="rounded-full bg-[#D9EBD6] px-2 py-0.5 font-mono-ui text-[9px] text-[#3F744A]">Complete</span>}</div><h3 className="mt-1 truncate text-[14px] font-bold">{lesson.title}</h3><p className="mt-1 truncate text-[11px] text-muted-foreground">{lesson.description}</p></div><div className="hidden items-center gap-1 font-mono-ui text-[10px] text-muted-foreground sm:flex"><Clock3 size={12} /> {lesson.durationMinutes}m</div>{!locked && <button type="button" data-testid={`button-toggle-lesson-${lesson.id}`} disabled={progress.isPending} onClick={() => toggleLesson(lesson.id, !lesson.completed)} className={`rounded-lg p-2 text-xs font-bold ${lesson.completed ? 'text-muted-foreground hover:bg-muted' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}>{lesson.completed ? <Check size={15} /> : <span className="hidden sm:inline">Mark done</span>}</button>}{locked && <LockKeyhole size={14} className="text-muted-foreground" />}</div> })}</div></div>
          <aside className="h-fit rounded-2xl border border-border bg-secondary/45 p-5"><div className="flex items-center gap-2"><Sparkles size={15} className="text-primary" /><p className="font-mono-ui text-[10px] uppercase tracking-[.17em] text-primary">Make it stick</p></div><p className="mt-4 font-display text-[25px] leading-[1.05]">One idea, used twice, becomes a skill.</p><p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">After each lesson, try applying the concept to something you already work on. Specific beats impressive.</p><Link href="/practice" data-testid="link-course-practice" className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline">Open practice coach <ArrowRight size={13} /></Link></aside>
        </section>
      </div>}
    </QueryState>
  </AcademyShell>;
}