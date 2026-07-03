/**
 * OpenAI Wrapper — structured error handling for all OpenAI calls in the bot.
 *
 * Wraps chat completion and image generation with:
 * - Error categorization (rate_limit, quota, network, invalid_request, unknown)
 * - Structured logging to system_events via logSystemEvent
 * - Returns null on failure — never re-throws (callers must handle null)
 * - Basic stats logging (model, source, token usage when available)
 */

import OpenAI from 'openai';
import { logSystemEvent } from './systemEvents';

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Error categorization ──────────────────────────────────────────────────────

interface OpenAIErrorInfo {
  eventType: string;
  severity: 'warning' | 'error';
  label: string;
}

function categorizeError(err: any): OpenAIErrorInfo & { status?: number } {
  const status = err?.status as number | undefined;
  const message: string = err?.message ?? String(err);

  if (status === 429) {
    return { eventType: 'OPENAI_RATE_LIMIT', severity: 'warning', label: 'rate_limit', status };
  }

  if (status === 402 || message.toLowerCase().includes('quota') || message.toLowerCase().includes('billing')) {
    return { eventType: 'OPENAI_QUOTA_EXCEEDED', severity: 'error', label: 'quota_exceeded', status };
  }

  const isNetwork =
    err?.code === 'ECONNRESET' ||
    err?.code === 'ENOTFOUND' ||
    err?.code === 'ETIMEDOUT' ||
    message.toLowerCase().includes('fetch failed') ||
    message.toLowerCase().includes('network') ||
    message.toLowerCase().includes('timeout') ||
    status === 503 ||
    status === 502;

  if (isNetwork) {
    return { eventType: 'OPENAI_NETWORK_ERROR', severity: 'warning', label: 'network_error', status };
  }

  if (status === 400 || status === 422) {
    return { eventType: 'OPENAI_ERROR', severity: 'error', label: 'invalid_request', status };
  }

  return { eventType: 'OPENAI_ERROR', severity: 'error', label: 'unknown_error', status };
}

// ── Chat completion ───────────────────────────────────────────────────────────

export async function callChatCompletion(
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  context: { source: string; workspaceId?: string },
): Promise<OpenAI.Chat.ChatCompletion | null> {
  try {
    const res = await openaiClient.chat.completions.create(params, { signal: AbortSignal.timeout(30_000) });

    // Log usage when available
    const usage = res.usage;
    if (usage) {
      console.log(
        `[OpenAI] ${context.source} — model=${params.model} prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} total=${usage.total_tokens}`,
      );
    }

    return res;
  } catch (err: any) {
    const { eventType, severity, label, status } = categorizeError(err);
    const message: string = err?.message ?? String(err);

    console.error(`[OpenAI] ${context.source} — ${label}: ${message}`);

    logSystemEvent({
      workspaceId: context.workspaceId,
      source: context.source,
      event_type: eventType,
      title: `OpenAI chat feilet (${label}): ${message.slice(0, 120)}`,
      severity,
      metadata: {
        model: params.model,
        source: context.source,
        errorMessage: message.slice(0, 500),
        errorLabel: label,
        statusCode: status ?? null,
      },
    });

    return null;
  }
}

// ── Image generation ──────────────────────────────────────────────────────────

export async function callImageGeneration(
  params: OpenAI.Images.ImageGenerateParams,
  context: { source: string; workspaceId?: string },
): Promise<OpenAI.Images.ImagesResponse | null> {
  try {
    const res = await openaiClient.images.generate(params, { signal: AbortSignal.timeout(90_000) });
    return res;
  } catch (err: any) {
    const { eventType, severity, label, status } = categorizeError(err);
    const message: string = err?.message ?? String(err);

    console.error(`[OpenAI] ${context.source} image — ${label}: ${message}`);

    logSystemEvent({
      workspaceId: context.workspaceId,
      source: context.source,
      event_type: eventType,
      title: `OpenAI image feilet (${label}): ${message.slice(0, 120)}`,
      severity,
      metadata: {
        model: params.model,
        source: context.source,
        errorMessage: message.slice(0, 500),
        errorLabel: label,
        statusCode: status ?? null,
      },
    });

    return null;
  }
}
