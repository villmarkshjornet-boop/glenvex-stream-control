import { logSystemEvent } from './systemEvents';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';

export function logApiError(opts: {
  service: string;
  endpoint: string;
  statusCode?: number | null;
  errorMessage: string;
  workspaceId?: string;
}): void {
  const { service, endpoint, statusCode, errorMessage, workspaceId } = opts;

  let event_type = 'API_ERROR';
  let severity: 'error' | 'warning' = 'error';

  if (service === 'Twitch') {
    if (statusCode === 401)      { event_type = 'TWITCH_AUTH_ERROR'; }
    else if (statusCode === 429) { event_type = 'TWITCH_RATE_LIMIT'; severity = 'warning'; }
    else if (!statusCode)        { event_type = 'TWITCH_NETWORK_ERROR'; }
  }

  logSystemEvent({
    source: 'api_monitor',
    event_type,
    title: `${service} API feil: ${statusCode ? `HTTP ${statusCode}` : 'nettverksfeil'} på ${endpoint}`,
    description: errorMessage.slice(0, 200),
    severity,
    metadata: {
      service,
      endpoint,
      status_code: statusCode ?? null,
      error_message: errorMessage.slice(0, 300),
      workspace_id: workspaceId ?? WORKSPACE_ID,
    },
  });
}

export function logDbError(opts: {
  table: string;
  operation: 'insert' | 'update' | 'delete' | 'select' | 'upsert';
  errorMessage: string;
  queryContext?: string;
  workspaceId?: string;
}): void {
  const { table, operation, errorMessage, queryContext, workspaceId } = opts;
  logSystemEvent({
    source: 'database',
    event_type: 'DATABASE_ERROR',
    title: `DB ${operation.toUpperCase()} feilet på ${table}`,
    description: errorMessage.slice(0, 200),
    severity: 'error',
    metadata: {
      table,
      operation,
      error_message: errorMessage.slice(0, 300),
      workspace_id: workspaceId ?? WORKSPACE_ID,
      ...(queryContext ? { query_context: queryContext.slice(0, 200) } : {}),
    },
  });
}

export async function withCron<T>(
  jobName: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const start = Date.now();
  logSystemEvent({
    source: 'cron',
    event_type: 'CRON_EXECUTED',
    title: `Cron startet: ${jobName}`,
    severity: 'info',
    metadata: { job_name: jobName, started_at: new Date().toISOString() },
  });
  try {
    const result = await fn();
    logSystemEvent({
      source: 'cron',
      event_type: 'CRON_COMPLETED',
      title: `Cron ferdig: ${jobName}`,
      severity: 'info',
      metadata: { job_name: jobName, duration_ms: Date.now() - start },
    });
    return result;
  } catch (err: any) {
    logSystemEvent({
      source: 'cron',
      event_type: 'CRON_FAILED',
      title: `Cron feilet: ${jobName}`,
      severity: 'error',
      metadata: { job_name: jobName, duration_ms: Date.now() - start, error_message: err?.message?.slice(0, 200) ?? '' },
    });
    return null;
  }
}
