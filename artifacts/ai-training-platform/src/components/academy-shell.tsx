import { Bell, BookOpen, BrainCircuit, ChevronRight, Compass, LayoutDashboard, Menu, Sparkles, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useClerk, useUser } from '@clerk/react';
import { Link, useLocation } from 'wouter';

type AcademyShellProps = { children: ReactNode; learnerName?: string; learnerLevel?: string };

const navigation = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/courses', label: 'Course library', icon: BookOpen },
  { href: '/practice', label: 'Practice coach', icon: BrainCircuit },
];

export function AcademyShell({ children, learnerName = 'Maya Chen', learnerLevel = 'Building fluency' }: AcademyShellProps) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = learnerName.split(' ').map((word) => word[0]).join('').slice(0, 2);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[256px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3 px-7 pb-8 pt-8">
          <div className="grid h-10 w-10 place-items-center rounded-[13px] bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_8px_18px_hsl(var(--sidebar-primary)/.2)]">
            <Sparkles size={19} strokeWidth={2.4} />
          </div>
          <div>
            <p className="font-display text-[21px] leading-none tracking-tight">Lumen</p>
            <p className="mt-1 font-mono-ui text-[9px] uppercase tracking-[.24em] text-sidebar-foreground/55">AI Academy</p>
          </div>
        </div>

        <nav className="flex-1 px-4">
          <p className="px-3 pb-3 font-mono-ui text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/40">Your space</p>
          <div className="space-y-1">
            {navigation.map(({ href, label, icon: Icon }) => {
              const active = href === '/' ? location === '/' : location.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
                  className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold transition-colors ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}
                >
                  <Icon size={17} strokeWidth={active ? 2.3 : 1.8} />
                  <span>{label}</span>
                  {active && <ChevronRight className="ml-auto text-sidebar-primary" size={14} />}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="mx-4 mb-5 rounded-2xl border border-sidebar-border bg-sidebar-accent/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-sidebar-primary lumen-pulse" />
            <span className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-sidebar-primary">Your momentum</span>
          </div>
          <p className="text-[12px] leading-relaxed text-sidebar-foreground/65">Small sessions compound into useful instincts.</p>
          <Link href="/practice" data-testid="link-sidebar-practice" className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-sidebar-primary hover:underline">
            Keep going <ChevronRight size={13} />
          </Link>
        </div>

        <div className="flex items-center gap-3 border-t border-sidebar-border px-6 py-5">
          <div data-testid="avatar-learner" className="grid h-9 w-9 place-items-center rounded-full bg-sidebar-primary font-mono-ui text-[11px] font-medium text-sidebar-primary-foreground">{initials}</div>
          <div className="min-w-0">
            <p data-testid="text-learner-name" className="truncate text-[12px] font-semibold">{learnerName}</p>
            <p data-testid="text-learner-level" className="truncate text-[11px] text-sidebar-foreground/50">{learnerLevel}</p>
          </div>
          <button type="button" data-testid="button-notifications" aria-label="Notifications" className="ml-auto rounded-lg p-2 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground">
            <Bell size={16} />
          </button>
        </div>
      </aside>

      <div className="lg:pl-[256px]">
        <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-border/75 bg-background/90 px-5 backdrop-blur-md sm:px-8 lg:px-11">
          <div className="flex items-center gap-3">
            <button type="button" data-testid="button-open-menu" aria-label="Open navigation" onClick={() => setMenuOpen(true)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted lg:hidden">
              <Menu size={20} />
            </button>
            <Link href="/" data-testid="link-mobile-logo" className="flex items-center gap-2 lg:hidden">
              <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-primary text-primary-foreground"><Sparkles size={15} /></span>
              <span className="font-display text-[19px]">Lumen</span>
            </Link>
            <div className="hidden items-center gap-2 text-[12px] text-muted-foreground sm:flex">
              <Compass size={15} />
              <span>Learning space</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground sm:block">Tuesday, Oct 22</span>
            <AccountControls />
            <div className="grid h-8 w-8 place-items-center rounded-full bg-accent/70 font-mono-ui text-[10px] font-medium text-accent-foreground lg:hidden">{initials}</div>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 lg:px-11 lg:py-10">{children}</main>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-foreground/30 lg:hidden" onClick={() => setMenuOpen(false)}>
          <aside className="h-full w-[280px] bg-sidebar p-5 text-sidebar-foreground shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between px-2 pb-8 pt-2">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><Sparkles size={17} /></span>
                <span className="font-display text-[21px]">Lumen</span>
              </div>
              <button type="button" data-testid="button-close-menu" aria-label="Close navigation" onClick={() => setMenuOpen(false)} className="rounded-lg p-2 text-sidebar-foreground/60 hover:bg-sidebar-accent"><X size={18} /></button>
            </div>
            <nav className="space-y-1">
              {navigation.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} data-testid={`link-mobile-nav-${label.toLowerCase().replaceAll(' ', '-')}`} onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-sidebar-foreground/70 hover:bg-sidebar-accent">
                  <Icon size={17} /> {label}
                </Link>
              ))}
            </nav>
          </aside>
        </div>
      )}

      <nav className="fixed inset-x-3 bottom-3 z-30 flex h-14 items-center justify-around rounded-2xl border border-border bg-card/95 shadow-[0_8px_30px_hsl(var(--foreground)/.12)] backdrop-blur lg:hidden">
        {navigation.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? location === '/' : location.startsWith(href);
          return <Link key={href} href={href} data-testid={`link-bottom-nav-${label.toLowerCase().replaceAll(' ', '-')}`} className={`flex flex-col items-center gap-1 px-4 py-2 text-[10px] font-semibold ${active ? 'text-primary' : 'text-muted-foreground'}`}><Icon size={17} /><span>{label.replace('Course library', 'Courses').replace('Practice coach', 'Practice')}</span></Link>;
        })}
      </nav>
    </div>
  );
}

function AccountControls() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  if (!isLoaded) return null;

  if (!isSignedIn) {
    return <Link href="/sign-in" className="rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-foreground hover:bg-muted/60">Sign in</Link>;
  }

  const identityLabel = user?.firstName || user?.primaryEmailAddress?.emailAddress || 'Learner account';

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="hidden max-w-[180px] truncate text-[11px] text-muted-foreground sm:block" title={identityLabel}>{identityLabel}</span>
      <button
        type="button"
        onClick={() => void signOut({ redirectUrl: basePath || '/' })}
        className="rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-foreground hover:bg-muted/60"
      >
        Sign out
      </button>
    </div>
  );
}
