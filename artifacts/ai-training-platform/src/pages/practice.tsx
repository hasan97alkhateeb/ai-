import { ArrowRight, Check, CircleHelp, Crown, Lightbulb, RotateCcw, Send, Sparkles, Target, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import { getGetPracticeHistoryQueryKey, getGetPracticeRecommendationQueryKey, getGetPracticeUsageQueryKey, useCreatePracticeProCheckout, useGetPracticeHistory, useGetPracticeRecommendation, useGetPracticeUsage, useSubmitPracticeAttempt } from '@workspace/api-client-react';
import type { ErrorResponse, PracticeAttempt, PracticeHistory, PracticeQuestion, PracticeUsage } from '@workspace/api-client-react';
import { AcademyShell } from '@/components/academy-shell';
import { Button, EmptyState, QueryState } from '@/components/academy-ui';
import { Link } from 'wouter';

export default function PracticePage() {
  const { isLoaded, isSignedIn, userId } = useAuth();

  if (!isLoaded) {
    return <AcademyShell><p className="text-sm text-muted-foreground">Loading your learner account…</p></AcademyShell>;
  }

  if (!isSignedIn) {
    return <PracticeSignInGate />;
  }

  return <PracticeCoachWorkspace key={userId ?? 'signed-in'} userId={userId ?? ''} />;
}

function PracticeSignInGate() {
  return <AcademyShell>
    <section className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-7 shadow-[0_4px_18px_hsl(var(--foreground)/.035)] sm:p-10">
      <p className="font-mono-ui text-[10px] uppercase tracking-[.22em] text-primary">Practice coach</p>
      <h1 className="mt-3 font-display text-[38px] leading-tight tracking-[-.035em]">Sign in to keep your progress.</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Your monthly coaching allowance is attached to your learner account, so it stays consistent across your devices and browser sessions.</p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Link href="/sign-in" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-[12px] font-bold text-primary-foreground hover:bg-primary/90">Sign in <ArrowRight size={14} /></Link>
        <Link href="/sign-up" className="inline-flex items-center justify-center rounded-xl border border-border px-4 py-3 text-[12px] font-bold text-foreground hover:bg-muted/60">Create learner account</Link>
      </div>
    </section>
  </AcademyShell>;
}

function PracticeCoachWorkspace({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [activeQuestion, setActiveQuestion] = useState<PracticeQuestion | null>(null);
  const [activeReason, setActiveReason] = useState<string | null>(null);
  const [seenQuestionIds, setSeenQuestionIds] = useState<string[]>([]);
  const [sessionAttempts, setSessionAttempts] = useState(0);
  const [answer, setAnswer] = useState('');
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null);
  const [showUpgradeHelp, setShowUpgradeHelp] = useState(false);
  const recommendationParams = useMemo(
    () => ({ excludeQuestionIds: seenQuestionIds }),
    [seenQuestionIds],
  );
  const recommendationKey = [
    ...getGetPracticeRecommendationQueryKey(recommendationParams),
    userId,
  ] as const;
  const historyKey = [...getGetPracticeHistoryQueryKey(), userId] as const;
  const usageKey = [...getGetPracticeUsageQueryKey(), userId] as const;
  const recommendationQuery = useGetPracticeRecommendation(recommendationParams, {
    query: {
      queryKey: recommendationKey,
      retry: (count, error) => (error as { status?: number }).status !== 409 && count < 2,
    },
  });
  const historyQuery = useGetPracticeHistory({
    query: {
      queryKey: historyKey,
      retry: (count, error) => (error as { status?: number }).status !== 409 && count < 2,
    },
  });
  const usageQuery = useGetPracticeUsage({
    query: {
      queryKey: usageKey,
      retry: (count, error) => (error as { status?: number }).status !== 409 && count < 2,
      refetchInterval: (query) => (query.state.error as { status?: number } | null)?.status === 409 ? 15_000 : false,
    },
  });
  const submit = useSubmitPracticeAttempt();
  const checkout = useCreatePracticeProCheckout();
  const question = activeQuestion ?? recommendationQuery.data?.question;
  const returnedFromCheckout = useMemo(() => new URLSearchParams(window.location.search).get('billing') === 'complete', []);
  const usageStatus = (usageQuery.error as { status?: number } | null)?.status;
  const conflict = (usageQuery.error as { data?: ErrorResponse } | null)?.data;
  const recommendationStatus = (recommendationQuery.error as { status?: number } | null)?.status;
  const submitStatus = (submit.error as { status?: number } | null)?.status;
  const checkoutStatus = (checkout.error as { status?: number } | null)?.status;
  const limitReached = usageQuery.data?.remaining === 0 || submitStatus === 429;

  useEffect(() => {
    if (!returnedFromCheckout) return;
    let stopped = false;
    let interval: number | undefined;
    const stopPolling = () => {
      stopped = true;
      if (interval !== undefined) window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
    const timeout = window.setTimeout(stopPolling, 30_000);
    interval = window.setInterval(() => {
      void usageQuery.refetch().then(({ data }) => {
        if (data?.plan === 'pro') stopPolling();
      });
    }, 3_000);
    void usageQuery.refetch().then(({ data }) => {
      if (data?.plan === 'pro') stopPolling();
    });
    return () => {
      if (!stopped) stopPolling();
    };
  }, [returnedFromCheckout, usageQuery.refetch]);

  const startProCheckout = () => {
    checkout.mutate(undefined, {
      onSuccess: (result) => window.location.assign(result.purchaseUrl),
      onError: (error) => {
        if ((error as { status?: number }).status === 409) {
          void usageQuery.refetch();
        }
      },
    });
  };

  const submitAnswer = () => {
    if (!question || !answer) return;
    submit.mutate({ data: { questionId: question.id, answer } }, {
      onSuccess: (result) => {
        setActiveQuestion(question);
        setActiveReason(recommendationQuery.data?.reason ?? null);
        setAttempt(result);
        setSeenQuestionIds((current) =>
          [...new Set([...current, question.id])].slice(-20),
        );
        setSessionAttempts((current) => current + 1);
        queryClient.setQueryData(usageKey, result.usage);
        queryClient.invalidateQueries({ queryKey: historyKey });
      },
      onError: (error) => {
        if ([409, 429].includes((error as { status?: number }).status ?? 0)) void usageQuery.refetch();
      },
    });
  };
  const next = () => {
    const nextQuestion = recommendationQuery.data?.question;
    if (!nextQuestion) return;
    setActiveQuestion(nextQuestion);
    setActiveReason(recommendationQuery.data?.reason ?? null);
    setAnswer('');
    setAttempt(null);
  };
  const reset = () => {
    setAnswer('');
    setAttempt(null);
    setActiveQuestion(null);
    setActiveReason(null);
    setSessionAttempts(0);
  };
  const showPageError =
    (recommendationQuery.isError && recommendationStatus !== 409) ||
    (usageQuery.isError && usageStatus !== 409);

  return <AcademyShell>
    <QueryState loading={recommendationQuery.isLoading || usageQuery.isLoading} error={showPageError} onRetry={() => { void recommendationQuery.refetch(); void usageQuery.refetch(); void historyQuery.refetch(); }}>
      {usageStatus === 409 ? <section role="alert" className="mx-auto max-w-xl rounded-2xl border border-destructive/20 bg-destructive/5 p-7">
        <p className="font-mono-ui text-[10px] uppercase tracking-[.15em] text-muted-foreground">Awaiting support verification</p>
        <h1 className="mt-3 font-display text-[30px] leading-tight">Your account needs help linking a subscription.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Two separate subscriptions need an ownership check. Coaching and new checkouts are paused; your usage history has been preserved. Contact your academy administrator with the reference below so they can verify both memberships and approve the account to keep.</p>
        {conflict?.conflictId && <p className="mt-4 break-all rounded-lg border border-border bg-card p-3 font-mono-ui text-xs">Support reference: {conflict.conflictId}</p>}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Linking does not cancel subscriptions or issue refunds. Your administrator must resolve any duplicate billing with Whop before completing the link. This page checks for approval automatically.</p>
        <Button type="button" variant="outline" className="mt-5" disabled={usageQuery.isFetching} onClick={() => { void usageQuery.refetch(); }}>{usageQuery.isFetching ? 'Checking status…' : 'Check status'}</Button>
       </section> : <div className="mx-auto max-w-[1000px] space-y-8">
         <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.22em] text-primary">Practice coach</p><h1 data-testid="heading-practice" className="mt-3 font-display text-[45px] leading-none tracking-[-.035em] sm:text-[56px]">Think it through.</h1><p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">A quiet space to test your instincts, get useful feedback, and try again.</p></div><div data-testid="text-practice-session-count" className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 font-mono-ui text-[10px] text-muted-foreground"><span className="text-primary">{sessionAttempts}</span> completed this session</div></section>
         {returnedFromCheckout && <p role="status" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">{usageQuery.data?.plan === 'pro' ? 'Pro coaching is active.' : 'Checkout returned successfully. Pro access will appear after Whop confirms the subscription.'}</p>}
         {checkout.isError && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-[12px] text-destructive">{checkoutStatus === 503 ? 'Pro checkout is not configured yet. Contact your academy administrator.' : checkoutStatus === 409 ? 'A Pro subscription is already linked to this learner. Refreshing your subscription status.' : 'Unable to start checkout right now. Please try again.'}</p>}
         {usageQuery.data && <UsageCard usage={usageQuery.data} showUpgradeHelp={showUpgradeHelp} onShowUpgradeHelp={() => setShowUpgradeHelp(true)} onStartProCheckout={startProCheckout} checkoutPending={checkout.isPending} />}
         {!question ? <EmptyState title="No practice question yet" description="Your coach could not find a question right now. Try again in a moment." action={<Button type="button" variant="outline" onClick={() => recommendationQuery.refetch()}><RotateCcw size={14} /> Try again</Button>} /> : <>
        <section className="grid gap-5 lg:grid-cols-[1fr_270px]">
          <div className="rounded-2xl border border-card-border bg-card p-5 shadow-[0_4px_18px_hsl(var(--foreground)/.035)] sm:p-8">
             <div className="flex items-start gap-2 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground"><Target size={14} className="mt-0.5 shrink-0 text-primary" /><span><strong className="text-foreground">Why this question:</strong> {activeReason ?? recommendationQuery.data?.reason}</span></div>
             <div className="mt-6 flex items-start justify-between gap-4"><div className="flex flex-wrap items-center gap-2"><span data-testid="text-practice-skill" className="rounded-full bg-secondary px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.14em] text-primary">{question.skill}</span><span data-testid="text-practice-difficulty" className="rounded-full bg-muted px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.14em] text-muted-foreground">{question.difficulty}</span></div><span className="font-mono-ui text-[10px] text-muted-foreground">Q{sessionAttempts + 1}</span></div>
             <div className="mt-7"><p className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground">The situation</p><p className="mt-3 rounded-xl bg-secondary/45 p-4 text-[13px] leading-relaxed text-secondary-foreground">{question.context}</p><h2 data-testid="text-practice-question" className="mt-7 max-w-2xl text-[22px] font-bold leading-snug tracking-[-.02em] sm:text-[27px]">{question.prompt}</h2></div>
              {!attempt && !limitReached ? <div className="mt-7 space-y-2">{question.options.map((option, optionIndex) => <button key={option} type="button" data-testid={`button-answer-${optionIndex}`} onClick={() => setAnswer(option)} className={`group flex w-full items-start gap-3 rounded-xl border p-4 text-left text-[13px] transition-all ${answer === option ? 'border-primary bg-primary/5 shadow-[0_0_0_2px_hsl(var(--primary)/.1)]' : 'border-border hover:border-primary/35 hover:bg-muted/50'}`}><span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono-ui text-[10px] ${answer === option ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}>{String.fromCharCode(65 + optionIndex)}</span><span className="leading-relaxed">{option}</span></button>)}</div> : attempt ? <FeedbackCard attempt={attempt} /> : <LimitReached usage={usageQuery.data!} showUpgradeHelp={showUpgradeHelp} onShowUpgradeHelp={() => setShowUpgradeHelp(true)} onStartProCheckout={startProCheckout} checkoutPending={checkout.isPending} />}
             <div className="mt-7 flex flex-col-reverse justify-between gap-3 border-t border-border pt-5 sm:flex-row sm:items-center">{attempt ? <p data-testid="text-attempt-feedback" className={`flex items-center gap-2 text-xs font-bold ${attempt.correct ? 'text-[#3F744A]' : 'text-destructive'}`}>{attempt.correct ? <Check size={15} /> : <X size={15} />}{attempt.correct ? 'Good instinct.' : 'Useful miss. Read the feedback, then try the next one.'}</p> : limitReached ? <p role="status" className="text-[11px] font-medium text-destructive">Your monthly coaching allowance is used up.</p> : submit.isError ? <p className="text-[11px] font-medium text-destructive">{submitStatus === 429 ? 'Your monthly coaching allowance is used up.' : 'The coach is taking a short pause. Try submitting again.'}</p> : <p className="text-[11px] text-muted-foreground">Choose the answer that feels most useful, not most clever.</p>}{attempt ? <><Button type="button" data-testid="button-next-practice" onClick={next} disabled={!recommendationQuery.data?.question || recommendationQuery.isFetching}>{recommendationQuery.isFetching ? 'Choosing your next question…' : 'Next question'} <ArrowRight size={14} /></Button>{recommendationQuery.isError && <Button type="button" variant="outline" onClick={() => recommendationQuery.refetch()}>Try again</Button>}</> : <Button type="button" data-testid="button-submit-practice" onClick={submitAnswer} disabled={!answer || submit.isPending || limitReached}>{submit.isPending ? 'Coaching...' : 'Submit answer'} <Send size={14} /></Button>}</div>
          </div>
           <aside className="space-y-4">
             <div className="rounded-2xl bg-sidebar p-5 text-sidebar-foreground"><div className="flex items-center gap-2 text-sidebar-primary"><Sparkles size={15} /><span className="font-mono-ui text-[10px] uppercase tracking-[.16em]">Coach note</span></div><p className="mt-5 font-display text-[26px] leading-[1.05]">Practice that responds to you.</p><p className="mt-3 text-[12px] leading-relaxed text-sidebar-foreground/60">Your recent answers guide which skill and difficulty come next. Steady progress raises the challenge; missed concepts get another look.</p></div>
             <PracticeProgress history={historyQuery.data} loading={historyQuery.isLoading} error={historyQuery.isError} onRetry={() => historyQuery.refetch()} />
           </aside>
        </section>
        </>}
      </div>}
    </QueryState>
  </AcademyShell>;
}

function PracticeProgress({ history, loading, error, onRetry }: { history?: PracticeHistory; loading: boolean; error: boolean; onRetry: () => void }) {
  return <section className="rounded-2xl border border-border bg-card p-5" aria-label="Practice history and skill progress">
    <div className="flex items-center gap-2"><Lightbulb size={15} className="text-primary" /><span className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-primary">Your progress</span></div>
    {loading ? <p className="mt-4 text-[11px] text-muted-foreground">Loading your recent practice…</p> : error ? <div className="mt-4"><p className="text-[11px] text-muted-foreground">Progress could not be loaded.</p><Button type="button" data-testid="button-retry-practice-history" variant="outline" className="mt-3 px-3 py-2 text-[10px]" onClick={onRetry}>Try again</Button></div> : <>
      <div className="mt-4 space-y-3">
        {history?.skillProgress.map((skill) => <div key={skill.skill} data-testid={`progress-skill-${skill.skill.replaceAll(' ', '-').toLowerCase()}`}>
          <div className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold">{skill.skill}</span><span className="font-mono-ui text-[9px] text-muted-foreground">{skill.recentAttempts ? `${skill.accuracyPercent}% recent` : 'New'}</span></div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${skill.skill} recent accuracy`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={skill.accuracyPercent}><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${skill.accuracyPercent}%` }} /></div>
          <p className="mt-1 text-[9px] text-muted-foreground">{skill.recentAttempts ? `${skill.recentAttempts} recent ${skill.recentAttempts === 1 ? 'attempt' : 'attempts'} · next ${skill.nextDifficulty}` : `Next ${skill.nextDifficulty}`}</p>
        </div>)}
      </div>
      <div className="mt-5 border-t border-border pt-4">
        <p className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-muted-foreground">Recent attempts</p>
        {!history?.attempts.length ? <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Your completed practice and coach feedback will appear here.</p> : <div className="mt-3 space-y-3">
          {history.attempts.slice(0, 4).map((item) => <article key={item.attemptId} data-testid={`history-attempt-${item.attemptId}`} className="border-l-2 border-primary/25 pl-3">
            <div className="flex items-center justify-between gap-2"><span className={`text-[9px] font-bold ${item.correct ? 'text-[#3F744A]' : 'text-destructive'}`}>{item.correct ? 'Correct' : 'Review'}</span><span className="font-mono-ui text-[8px] text-muted-foreground">{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(item.createdAt))}</span></div>
            <p className="mt-1 text-[10px] font-semibold leading-snug">{item.skill} · {item.difficulty}</p>
            <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">{item.feedback}</p>
          </article>)}
        </div>}
      </div>
    </>}
  </section>;
}

type PracticeUsageData = PracticeUsage;

function UsageCard({ usage, showUpgradeHelp, onShowUpgradeHelp, onStartProCheckout, checkoutPending }: { usage: PracticeUsageData; showUpgradeHelp: boolean; onShowUpgradeHelp: () => void; onStartProCheckout: () => void; checkoutPending: boolean }) {
  const isPro = usage.plan === 'pro';
  const progress = Math.min(100, (usage.used / usage.monthlyLimit) * 100);
  const periodEndLabel = usage.subscriptionPeriodEndsAt
    ? new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(usage.subscriptionPeriodEndsAt))
    : null;
  return <section aria-label="Monthly coaching allowance" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-[0_4px_18px_hsl(var(--foreground)/.025)] sm:flex-row sm:items-center sm:justify-between sm:px-5">
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2"><span className={`grid h-8 w-8 place-items-center rounded-lg ${isPro ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'}`}>{isPro ? <Crown size={15} /> : <Sparkles size={15} />}</span><div><p className="text-[12px] font-bold">{isPro ? 'Pro coaching' : 'Free coaching'}</p><p data-testid="text-coaching-usage" className="mt-0.5 text-[11px] text-muted-foreground">{usage.remaining} of {usage.monthlyLimit} coaching replies left this month</p></div></div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Monthly coaching usage" aria-valuemin={0} aria-valuemax={usage.monthlyLimit} aria-valuenow={usage.used}><div className={`h-full rounded-full transition-[width] ${isPro ? 'bg-primary' : 'bg-accent'}`} style={{ width: `${progress}%` }} /></div>
      {!isPro && usage.checkoutAvailable && <p className="mt-2 text-[10px] text-muted-foreground">500 coaching replies each month · $15 USD every 30 days</p>}
    </div>
    {usage.subscriptionStatus === 'canceling' && <p className="text-[10px] leading-relaxed text-muted-foreground">{periodEndLabel ? `Your Pro access remains active through ${periodEndLabel}.` : 'Your Pro access remains active through the current billing period.'}</p>}
    {usage.subscriptionStatus === 'past_due' && <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end"><p className="text-[10px] font-bold text-destructive">{isPro && periodEndLabel ? `Payment needs attention; access remains through ${periodEndLabel}.` : 'Payment needs attention'}</p>{(usage.paymentRecoveryUrl || usage.subscriptionManagementUrl) ? <a href={usage.paymentRecoveryUrl || usage.subscriptionManagementUrl!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-bold text-primary hover:underline">Update payment <ArrowRight size={13} /></a> : <p className="max-w-[250px] text-[10px] text-muted-foreground sm:text-right">Contact your academy administrator to restore the subscription.</p>}</div>}
    {!isPro && ['canceled', 'expired'].includes(usage.subscriptionStatus ?? '') && <p className="text-[10px] leading-relaxed text-muted-foreground">{periodEndLabel ? `Your previous Pro access ended on ${periodEndLabel}.` : 'Your previous Pro subscription has ended.'}</p>}
    {isPro && usage.subscriptionManagementUrl && <a href={usage.subscriptionManagementUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-[12px] font-bold text-primary hover:underline">Manage subscription <ArrowRight size={13} /></a>}
    {!isPro && usage.subscriptionStatus !== 'past_due' && <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
      {usage.checkoutAvailable ? <Button type="button" variant="outline" className="px-3 py-2 text-[11px]" onClick={onStartProCheckout} disabled={checkoutPending}>{checkoutPending ? 'Opening checkout…' : 'Upgrade to Pro'} <ArrowRight size={13} /></Button> : usage.upgradeUrl ? <a href={usage.upgradeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-bold text-primary hover:underline">Upgrade to Pro <ArrowRight size={13} /></a> : <Button type="button" variant="outline" className="px-3 py-2 text-[11px]" onClick={onShowUpgradeHelp}>Upgrade to Pro <ArrowRight size={13} /></Button>}
      {showUpgradeHelp && !usage.checkoutAvailable && !usage.upgradeUrl && <p className="max-w-[250px] text-[10px] leading-relaxed text-muted-foreground sm:text-right">Contact your academy administrator to upgrade and unlock 500 coaching replies each month.</p>}
    </div>}
  </section>;
}

function LimitReached({ usage, showUpgradeHelp, onShowUpgradeHelp, onStartProCheckout, checkoutPending }: { usage: PracticeUsageData; showUpgradeHelp: boolean; onShowUpgradeHelp: () => void; onStartProCheckout: () => void; checkoutPending: boolean }) {
  const resetDate = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(usage.resetsAt));
  const isPro = usage.plan === 'pro';
  return <div role="alert" className="mt-7 rounded-xl border border-primary/20 bg-primary/5 p-5">
    <p className="font-bold">You’ve used this month’s coaching allowance.</p>
    <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{isPro ? `Your Pro allowance resets at midnight UTC on ${resetDate}.` : usage.checkoutAvailable ? `Your Free allowance resets at midnight UTC on ${resetDate}. Upgrade to Pro for 500 coaching replies each month for $15 USD every 30 days.` : `Your Free allowance resets at midnight UTC on ${resetDate}. Upgrade to Pro for 500 coaching replies each month.`}</p>
    {!isPro && usage.checkoutAvailable && <Button type="button" className="mt-4" onClick={onStartProCheckout} disabled={checkoutPending}>{checkoutPending ? 'Opening checkout…' : 'Upgrade to Pro'} <ArrowRight size={14} /></Button>}
    {!isPro && !usage.checkoutAvailable && (usage.upgradeUrl ? <a href={usage.upgradeUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[12px] font-bold text-primary-foreground hover:bg-primary/90">Upgrade to Pro <ArrowRight size={14} /></a> : <Button type="button" className="mt-4" onClick={onShowUpgradeHelp}>Upgrade to Pro <ArrowRight size={14} /></Button>)}
    {showUpgradeHelp && !usage.checkoutAvailable && !usage.upgradeUrl && !isPro && <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Contact your academy administrator to upgrade your plan.</p>}
  </div>;
}

function FeedbackCard({ attempt }: { attempt: any }) {
  return <div data-testid="card-practice-feedback" className={`mt-7 rounded-2xl border p-5 ${attempt.correct ? 'border-[#CDE2CA] bg-[#F3F8F1]' : 'border-destructive/20 bg-destructive/5'}`}><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className={`grid h-8 w-8 place-items-center rounded-full ${attempt.correct ? 'bg-[#D9EBD6] text-[#3F744A]' : 'bg-destructive/10 text-destructive'}`}>{attempt.correct ? <Check size={16} /> : <CircleHelp size={16} />}</span><span className="text-sm font-bold">{attempt.correct ? 'That’s the one.' : 'Not quite this time.'}</span></div><span className="font-mono-ui text-xs font-medium text-primary">+{attempt.pointsEarned} XP</span></div><p className="mt-4 text-[13px] leading-relaxed text-foreground/80">{attempt.feedback}</p>{!attempt.correct && <p className="mt-4 border-t border-destructive/15 pt-3 text-[11px] text-muted-foreground">Best answer: <span className="font-semibold text-foreground">{attempt.correctAnswer}</span></p>}</div>;
}