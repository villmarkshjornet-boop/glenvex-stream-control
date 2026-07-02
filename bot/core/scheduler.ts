/**
 * bot/core/scheduler.ts
 *
 * Central scheduler — all setInterval / setTimeout jobs that previously lived
 * in the clientReady handler of bot/index.ts are registered here.
 *
 * Call `startAllSchedulers(deps)` once from clientReady after all services
 * have been started.  Pass every recurring job function in via `deps` so this
 * module has zero coupling to bot/index.ts (no circular imports).
 */

import { logSystemEvent } from '../lib/systemEvents';
import { withCron }       from '../lib/observability';
import { runLearningEngine } from '../lib/learningEngine';

// ─── Interval constants (mirror the values in index.ts) ──────────────────────

const POLL_INTERVAL        = 2  * 60 * 1000;
const PROAKTIV_INTERVAL    = 8  * 60 * 60 * 1000;
const CLIP_INTERVAL        = 12 * 60 * 60 * 1000;
const STATS_SJEKK_INTERVAL = 6  * 60 * 60 * 1000;
const RYDD_SJEKK_INTERVAL  = 6  * 60 * 60 * 1000;
const SOCIALS_INTERVAL     = 8  * 60 * 60 * 1000;
const GOALS_INTERVAL       = 6  * 60 * 60 * 1000;

// ─── Dependency bag ───────────────────────────────────────────────────────────

/**
 * All recurring-job functions from bot/index.ts are passed in here so that
 * scheduler.ts never imports from index.ts (which would create a circular dep).
 */
export interface SchedulerDeps {
  checkLive:                      () => Promise<void>;
  writeHeartbeats:                () => void;
  sjekkPreHype:                   () => Promise<void>;
  dispatchApprovedProposalsRunner: () => Promise<void>;
  sendProaktivMelding:            () => Promise<void>;
  postTopClip:                    () => Promise<void>;
  delSocialsSubtilt:              () => Promise<void>;
  sjekkGoals:                     () => Promise<void>;
  sjekkUkentligStats:             () => Promise<void>;
  autoRyddKanaler:                () => Promise<void>;
  kjørDuplikatSkan:               () => Promise<void>;
  sjekkStuckeVodsPeriodisk:       () => Promise<void>;
  autoPostStreamplan:             () => Promise<void>;
  sjekkOgSendMVP:                 () => Promise<void>;
  sjekkOgSendHype:                () => Promise<void>;
  sjekkIdlePrompt:                () => Promise<void>;
}

// ─── Error wrapper ────────────────────────────────────────────────────────────

function safeRun(name: string, fn: () => unknown): void {
  try {
    const result = fn();
    if (result && typeof (result as any).catch === 'function') {
      (result as Promise<unknown>).catch((err: any) => {
        console.log(`[SCHEDULER_ERROR] ${name}: ${err?.message}`);
        logSystemEvent({
          event_type: 'CRON_FAILED',
          source:     'scheduler',
          title:      `${name} feilt: ${err?.message}`,
          severity:   'error',
          metadata:   { error: err?.message },
        });
      });
    }
  } catch (err: any) {
    console.log(`[SCHEDULER_ERROR] ${name}: ${err?.message}`);
    logSystemEvent({
      event_type: 'CRON_FAILED',
      source:     'scheduler',
      title:      `${name} feilt: ${err?.message}`,
      severity:   'error',
      metadata:   { error: err?.message },
    });
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Registers all recurring setInterval / setTimeout jobs.
 * Call exactly once from clientReady, after all services are started.
 */
export function startAllSchedulers(deps: SchedulerDeps): void {
  const {
    checkLive,
    writeHeartbeats,
    sjekkPreHype,
    dispatchApprovedProposalsRunner,
    sendProaktivMelding,
    postTopClip,
    delSocialsSubtilt,
    sjekkGoals,
    sjekkUkentligStats,
    autoRyddKanaler,
    kjørDuplikatSkan,
    sjekkStuckeVodsPeriodisk,
    autoPostStreamplan,
    sjekkOgSendMVP,
    sjekkOgSendHype,
    sjekkIdlePrompt,
  } = deps;

  // ── Live-sjekk: start etter 5 sek, deretter hvert 2. min ─────────────────
  setTimeout(() => {
    safeRun('checkLive', checkLive);
    setInterval(() => safeRun('checkLive', checkLive), POLL_INTERVAL);
  }, 5_000);

  // ── Heartbeat: start etter 1 min, deretter hvert 5. min ──────────────────
  setTimeout(() => {
    safeRun('writeHeartbeats', writeHeartbeats);
    setInterval(() => safeRun('writeHeartbeats', writeHeartbeats), 5 * 60_000);
  }, 60_000);

  // ── Pre-hype: hvert 10. min ───────────────────────────────────────────────
  setInterval(() => safeRun('sjekkPreHype', sjekkPreHype), 10 * 60 * 1000);

  // ── Dispatch approved proposals: hvert 2. min ────────────────────────────
  setInterval(
    () => withCron('dispatch-approved-proposals', dispatchApprovedProposalsRunner),
    2 * 60 * 1000,
  );

  // ── Learning Engine: én gang etter 10 min, deretter daglig ───────────────
  setTimeout(
    () => runLearningEngine().catch(() => {}),
    10 * 60 * 1000,
  );
  setInterval(
    () => runLearningEngine().catch(() => {}),
    24 * 60 * 60 * 1000,
  );

  // ── Proaktiv melding: start etter 30 min, deretter hvert 8. time ─────────
  setTimeout(() => {
    withCron('send-proaktiv', sendProaktivMelding);
    setInterval(() => withCron('send-proaktiv', sendProaktivMelding), PROAKTIV_INTERVAL);
  }, 30 * 60 * 1000);

  // ── Top clip: start etter 1 time, deretter hvert 12. time ────────────────
  setTimeout(() => {
    withCron('post-top-clip', postTopClip);
    setInterval(() => withCron('post-top-clip', postTopClip), CLIP_INTERVAL);
  }, 60 * 60 * 1000);

  // ── Socials: start etter 3 timer, deretter hvert 8. time ─────────────────
  setTimeout(() => {
    withCron('del-socials', delSocialsSubtilt);
    setInterval(() => withCron('del-socials', delSocialsSubtilt), SOCIALS_INTERVAL);
  }, 3 * 60 * 60 * 1000);

  // ── Goals: start etter 2 timer, deretter hvert 6. time ───────────────────
  setTimeout(() => {
    withCron('sjekk-goals', sjekkGoals);
    setInterval(() => withCron('sjekk-goals', sjekkGoals), GOALS_INTERVAL);
  }, 2 * 60 * 60 * 1000);

  // ── Ukentlig stats: hvert 6. time ────────────────────────────────────────
  setInterval(() => safeRun('sjekkUkentligStats', sjekkUkentligStats), STATS_SJEKK_INTERVAL);

  // ── Auto-rydd kanaler: hvert 6. time ─────────────────────────────────────
  setInterval(() => safeRun('autoRyddKanaler', autoRyddKanaler), RYDD_SJEKK_INTERVAL);

  // ── Duplikat-skanning: hvert 6. time ─────────────────────────────────────
  setInterval(() => safeRun('kjørDuplikatSkan', kjørDuplikatSkan), RYDD_SJEKK_INTERVAL);

  // ── Stuck VODs: hvert 30. min ─────────────────────────────────────────────
  setInterval(
    () => safeRun('sjekkStuckeVodsPeriodisk', sjekkStuckeVodsPeriodisk),
    30 * 60 * 1000,
  );

  // ── Auto-post streamplan: hvert 6. time ──────────────────────────────────
  setInterval(() => safeRun('autoPostStreamplan', autoPostStreamplan), STATS_SJEKK_INTERVAL);

  // ── Community MVP: start etter 1 time, deretter hvert 4. time ────────────
  setTimeout(() => {
    withCron('community-mvp', sjekkOgSendMVP);
    setInterval(() => withCron('community-mvp', sjekkOgSendMVP), 4 * 60 * 60 * 1000);
  }, 60 * 60 * 1000);

  // ── Community Hype: start etter 2 timer, deretter hvert 8. time ──────────
  setTimeout(() => {
    withCron('community-hype', sjekkOgSendHype);
    setInterval(() => withCron('community-hype', sjekkOgSendHype), 8 * 60 * 60 * 1000);
  }, 2 * 60 * 60 * 1000);

  // ── Idle-prompt: hvert 30. min ────────────────────────────────────────────
  setInterval(
    () => safeRun('sjekkIdlePrompt', sjekkIdlePrompt),
    30 * 60 * 1000,
  );

  logSystemEvent({
    source:     'scheduler',
    event_type: 'SCHEDULER_STARTED',
    title:      'Alle schedulers registrert og aktive',
    severity:   'info',
    metadata:   { jobCount: 18 },
  });
}
