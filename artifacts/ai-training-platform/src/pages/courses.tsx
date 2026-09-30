import { BookOpen, Filter, Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useListCourses } from '@workspace/api-client-react';
import { AcademyShell } from '@/components/academy-shell';
import { Button, CourseCard, EmptyState, QueryState } from '@/components/academy-ui';

const levels = ['All levels', 'Beginner', 'Intermediate', 'Advanced'];
const categories = ['All topics', 'Prompting', 'Automation', 'Foundations', 'Analysis'];

export default function CoursesPage() {
  const [level, setLevel] = useState('All levels');
  const [category, setCategory] = useState('All topics');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const params = useMemo(() => ({ ...(level !== 'All levels' ? { level } : {}), ...(category !== 'All topics' ? { category } : {}) }), [level, category]);
  const courses = useListCourses(params);
  const filtered = (courses.data ?? []).filter((course) => `${course.title} ${course.subtitle} ${course.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase()));

  return <AcademyShell>
    <QueryState loading={courses.isLoading} error={courses.isError} onRetry={() => courses.refetch()}>
      <div className="space-y-8">
        <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div><p className="font-mono-ui text-[10px] uppercase tracking-[.22em] text-primary">The library</p><h1 data-testid="heading-courses" className="mt-3 font-display text-[45px] leading-none tracking-[-.035em] sm:text-[56px]">Learn with range.</h1><p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">Short, practical courses for the moments when you want to make AI useful — not just interesting.</p></div>
          <div className="hidden items-center gap-2 rounded-full bg-secondary px-3 py-2 text-[11px] font-semibold text-secondary-foreground sm:flex"><BookOpen size={14} /> {(courses.data ?? []).length} paths to explore</div>
        </section>

        <section className="rounded-2xl border border-card-border bg-card p-3 shadow-[0_4px_18px_hsl(var(--foreground)/.035)]">
          <div className="flex flex-col gap-3 md:flex-row">
            <label className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} /><input data-testid="input-course-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by skill, topic, or course..." className="h-11 w-full rounded-xl border-0 bg-muted/65 pl-10 pr-4 text-sm outline-none ring-0 placeholder:text-muted-foreground/70 focus:bg-secondary" /></label>
            <Button type="button" variant="outline" className="md:hidden" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={15} /> Filters <span className="rounded-full bg-accent px-1.5 text-[10px]">{(level !== 'All levels' ? 1 : 0) + (category !== 'All topics' ? 1 : 0)}</span></Button>
            <div className={`${filtersOpen ? 'flex' : 'hidden'} flex-col gap-3 md:flex md:flex-row`}>
              <FilterSelect testId="select-level" value={level} options={levels} onChange={setLevel} />
              <FilterSelect testId="select-category" value={category} options={categories} onChange={setCategory} />
            </div>
          </div>
          {(level !== 'All levels' || category !== 'All topics' || search) && <div className="flex flex-wrap items-center gap-2 px-1 pt-3"><span className="text-[11px] text-muted-foreground">Showing:</span>{search && <FilterChip label={`“${search}”`} onRemove={() => setSearch('')} />}{level !== 'All levels' && <FilterChip label={level} onRemove={() => setLevel('All levels')} />}{category !== 'All topics' && <FilterChip label={category} onRemove={() => setCategory('All topics')} />}</div>}
        </section>

        {filtered.length ? <div data-testid="course-grid" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((course) => <CourseCard key={course.id} course={course} />)}</div> : <EmptyState title="No close matches" description="Try a broader topic or clear one of the filters." action={<Button type="button" variant="quiet" onClick={() => { setSearch(''); setLevel('All levels'); setCategory('All topics'); }}>Clear filters</Button>} />}
      </div>
    </QueryState>
  </AcademyShell>;
}

function FilterSelect({ value, options, onChange, testId }: { value: string; options: string[]; onChange: (value: string) => void; testId: string }) {
  return <label className="relative"><span className="sr-only">{testId}</span><select data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 min-w-[145px] appearance-none rounded-xl border border-border bg-card px-3 pr-9 text-[12px] font-semibold outline-none focus:border-primary"><option>{options[0]}</option>{options.slice(1).map((option) => <option key={option}>{option}</option>)}</select><SlidersHorizontal size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-muted-foreground" /></label>;
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <button type="button" data-testid={`button-remove-filter-${label}`} onClick={onRemove} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-secondary-foreground">{label}<X size={12} /></button>;
}