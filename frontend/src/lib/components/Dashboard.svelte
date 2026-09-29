<script lang="ts">
  import { onMount } from 'svelte';
  import { tasks, selectedTaskId } from '$lib/stores/tasks';
  import { scopeFilter } from '$lib/stores/scope';
  import type { Task } from '$lib/types';
  import { isOpen, isOverdue, sameDay, startOfDay, addDays, hasDue } from '$lib/time';
  import { config, categoryMeta, taskColor } from '$lib/stores/config';
  import { subjectsOf, daysUntil } from '$lib/study';
  import { fmtWeekdayTime, fmtDayMonth } from '$lib/format';
  import { getLocale } from '$lib/i18n';
  import * as m from '$lib/paraglide/messages';
  import Icon from './Icon.svelte';

  // Re-evaluate "now"-dependent bits periodically so the countdown stays live.
  let now = $state(new Date());
  onMount(() => {
    const id = setInterval(() => (now = new Date()), 30_000);
    return () => clearInterval(id);
  });

  const open = $derived(($tasks as Task[]).filter((t) => $scopeFilter(t)));

  const todaySet = $derived(open.filter((t) => sameDay(new Date(t.due_at), now)));
  const doneToday = $derived(todaySet.filter((t) => t.status === 'done').length);
  const totalToday = $derived(todaySet.length);
  const pct = $derived(totalToday ? Math.round((doneToday / totalToday) * 100) : 0);

  // Open = open and on time; overdue = open but past due (computed). Disjoint counts.
  const openNow = $derived(open.filter((t) => isOpen(t) && !isOverdue(t)).length);
  const overdueNow = $derived(open.filter((t) => isOverdue(t)).length);
  const completedToday = $derived(
    open.filter((t) => t.completed_at && sameDay(new Date(t.completed_at), now)).length
  );

  const nextUp = $derived(
    open
      .filter((t) => isOpen(t) && new Date(t.due_at) >= now)
      .sort((a, b) => a.due_at.localeCompare(b.due_at))[0] ?? null
  );

  // Nearest upcoming exam (study mode); null when no subjects are configured.
  const nextExam = $derived(subjectsOf($config).find((s) => daysUntil(s.exam_date, now) >= 0) ?? null);

  function countdown(iso: string): string {
    const ms = new Date(iso).getTime() - now.getTime();
    if (ms < 0) return m.overdue();
    const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'always', style: 'short' });
    const min = Math.round(ms / 60000);
    if (min < 60) return rtf.format(min, 'minute');
    const h = Math.floor(min / 60);
    if (h < 24) return rtf.format(h, 'hour');
    return rtf.format(Math.round(h / 24), 'day');
  }
  const fmtTime = (iso: string) => fmtWeekdayTime(iso);

  // Donut geometry.
  const R = 34;
  const C = 2 * Math.PI * R;
  const dash = $derived((pct / 100) * C);

  // Macro-category lines: one thin line per service over the next 2 weeks,
  // each task a coloured dot at its due date. Compact "where am I" overview.
  const STRIP_DAYS = 14;
  const stripStart = $derived(startOfDay(now).getTime());
  const stripEnd = $derived(addDays(startOfDay(now), STRIP_DAYS).getTime());
  const stripPct = (iso: string) =>
    Math.min(100, Math.max(0, ((new Date(iso).getTime() - stripStart) / (stripEnd - stripStart)) * 100));
  const nowPct = $derived(((now.getTime() - stripStart) / (stripEnd - stripStart)) * 100);

  const cats = $derived.by(() => {
    const map = new Map<string, Task[]>();
    for (const t of open) {
      if (!hasDue(t)) continue; // general tasks have no date to place on the strip
      const due = new Date(t.due_at).getTime();
      if (due < stripStart || due > stripEnd) continue; // only the visible window
      const key = (t.services?.[0] ?? '').toLowerCase() || '_other';
      const arr = map.get(key) ?? (map.set(key, []), map.get(key)!);
      arr.push(t);
    }
    return [...map.entries()]
      .map(([key, ts]) => ({
        key,
        label: key === '_other' ? m.dash_other() : categoryMeta(key, $config).label,
        icon: key === '_other' ? 'dot' : categoryMeta(key, $config).icon,
        tasks: ts.sort((a, b) => a.due_at.localeCompare(b.due_at)),
      }))
      .sort((a, b) => a.tasks[0].due_at.localeCompare(b.tasks[0].due_at));
  });
  const dotClass = (t: Task) =>
    t.status === 'done' ? 'done' : isOverdue(t) ? 'late' : '';
</script>

<section class="dash glass">
  <div class="ring" role="img" aria-label={m.dash_done_aria({ done: doneToday, total: totalToday })}>
    <svg viewBox="0 0 80 80" width="80" height="80">
      <circle cx="40" cy="40" r={R} class="track" />
      <circle
        cx="40" cy="40" r={R} class="prog"
        stroke-dasharray={`${dash} ${C}`}
        transform="rotate(-90 40 40)"
      />
    </svg>
    <div class="ring-center">
      <b>{pct}%</b>
      <span>{m.dash_today_count({ done: doneToday, total: totalToday })}</span>
    </div>
  </div>

  <div class="stats">
    <div class="stat">
      <b class="n accent">{openNow}</b>
      <span>{m.view_open()}</span>
    </div>
    <div class="stat">
      <b class="n red" class:zero={overdueNow === 0}>{overdueNow}</b>
      <span>{m.dash_late()}</span>
    </div>
    <div class="stat">
      <b class="n green">{completedToday}</b>
      <span>{m.dash_done_today()}</span>
    </div>
  </div>

  <div class="next">
    <span class="lbl">{m.dash_next_deadline()}</span>
    {#if nextUp}
      <button class="next-task" onclick={() => selectedTaskId.set(nextUp.id)}>
        <span class="t">{nextUp.title}</span>
        <span class="meta">{fmtTime(nextUp.due_at)} · <em>{countdown(nextUp.due_at)}</em></span>
      </button>
    {:else}
      <span class="none">{m.dash_nothing_queued()}</span>
    {/if}
  </div>

  {#if nextExam}
    <div class="next">
      <span class="lbl">{m.study_next_exam()}</span>
      <a class="next-task" href="/timeline">
        <span class="t">{nextExam.label}</span>
        <span class="meta">{fmtDayMonth(new Date(nextExam.exam_date))} · <em>{countdown(nextExam.exam_date)}</em></span>
      </a>
    </div>
  {/if}

  <div class="catlines">
    <div class="cat-head">{m.dash_next_14()}</div>
    {#if cats.length}
      <div class="cat-grid">
        {#each cats as c (c.key)}
          <div class="cat-label" title={c.label}><span class="ci"><Icon name={c.icon} size={13} /></span><span class="cl">{c.label}</span></div>
          <div class="cat-line">
            {#each c.tasks as t (t.id)}
              <button
                class={`dot ${dotClass(t)}`}
                style={`left:${stripPct(t.due_at)}%; --c:${taskColor(t, $config)}`}
                title={`${t.title} · ${fmtTime(t.due_at)}`}
                onclick={() => selectedTaskId.set(t.id)}
                aria-label={t.title}
              ></button>
            {/each}
            <span class="ln-now" style={`left:${nowPct}%`}></span>
          </div>
        {/each}
      </div>
    {:else}
      <span class="cat-empty">{m.dash_nothing_14()}</span>
    {/if}
  </div>
</section>

<style>
  .dash {
    display: flex; align-items: center; gap: 22px; flex-wrap: wrap;
    padding: 16px 18px; margin-bottom: 4px;
  }
  .ring { position: relative; width: 80px; height: 80px; flex: 0 0 auto; }
  .ring svg { display: block; }
  .ring .track { fill: none; stroke: var(--bg-glass-hover); stroke-width: 8; }
  .ring .prog { fill: none; stroke: var(--green); stroke-width: 8; stroke-linecap: round; transition: stroke-dasharray 0.4s ease; }
  .ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; }
  .ring-center b { font-size: 19px; color: var(--text-primary); }
  .ring-center span { font-size: 10px; color: var(--text-muted); }

  .stats { display: flex; gap: 22px; }
  .stat { display: flex; flex-direction: column; gap: 2px; }
  .stat .n { font-size: 30px; font-weight: 700; line-height: 1; }
  .stat span { font-size: 12px; color: var(--text-muted); }
  .n.accent { color: var(--accent); }
  .n.green { color: var(--green); }
  .n.red { color: var(--red); }
  .n.red.zero { color: var(--text-muted); }

  .next { display: flex; flex-direction: column; gap: 4px; min-width: 180px; flex: 1; }
  .next .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
  .next-task {
    display: flex; flex-direction: column; gap: 2px; text-align: left;
    background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 6px;
    padding: 7px 10px; cursor: pointer; color: inherit; max-width: 320px; text-decoration: none;
  }
  .next-task:hover { background: var(--bg-glass-hover); }
  .next-task .t { font-size: 14px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .next-task .meta { font-size: 12px; color: var(--text-muted); }
  .next-task .meta em { color: var(--accent); font-style: normal; font-weight: 600; }
  .next .none { font-size: 14px; color: var(--text-secondary); }

  .catlines { display: flex; flex-direction: column; gap: 6px; min-width: 300px; flex: 2; }
  .cat-head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
  .cat-grid { display: grid; grid-template-columns: 92px 1fr; gap: 5px 8px; align-items: center; }
  .cat-label { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-secondary); min-width: 0; }
  .cat-label .ci { display: inline-flex; align-items: center; flex: 0 0 auto; color: var(--text-secondary); }
  .cat-label .cl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cat-line { position: relative; height: 12px; background: var(--bg-glass-hover); border-radius: 999px; }
  .dot { position: absolute; top: 50%; width: 11px; height: 11px; border-radius: 50%; transform: translate(-50%, -50%); background: var(--c, var(--accent)); border: 2px solid var(--bg-base); cursor: pointer; padding: 0; z-index: 2; }
  .dot.done { opacity: 0.45; }
  .dot.late { box-shadow: 0 0 0 2px var(--red); }
  .ln-now { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--text-primary); opacity: 0.5; transform: translateX(-50%); border-radius: 1px; }
  .cat-empty { font-size: 13px; color: var(--text-secondary); }
</style>
