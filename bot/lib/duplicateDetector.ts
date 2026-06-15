import { Collection, Message, TextChannel } from 'discord.js';
import { logSystemEvent } from './systemEvents';

export interface DupReport {
  id: string;
  kanalId: string;
  kanalNavn: string;
  signature: string;
  meldinger: Array<{ messageId: string; ts: number; preview: string }>;
  opprettet: number;
}

// Module-level store: reportId → DupReport
export const dupReports = new Map<string, DupReport>();

function contentSignature(content: string): string {
  return content.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function scanForDuplicates(
  channels: Collection<string, any>,
  botUserId: string,
  lookbackHours = 24
): Promise<DupReport[]> {
  const cutoff = Date.now() - lookbackHours * 3_600_000;
  const reports: DupReport[] = [];

  for (const [, ch] of channels) {
    if (ch.type !== 0) continue;
    const kanal = ch as TextChannel;

    let msgs: Collection<string, Message>;
    try {
      msgs = await kanal.messages.fetch({ limit: 100 });
    } catch {
      continue;
    }

    // Only scan bot's own messages within lookback window
    const botMsgs = [...msgs.values()].filter(
      m => m.author.id === botUserId && m.createdTimestamp >= cutoff
    );

    // Group by content signature
    const bySignature = new Map<string, Message[]>();
    for (const m of botMsgs) {
      const sig = contentSignature(m.content || m.embeds[0]?.description || m.embeds[0]?.title || '');
      if (!sig) continue;
      if (!bySignature.has(sig)) bySignature.set(sig, []);
      bySignature.get(sig)!.push(m);
    }

    for (const [sig, group] of bySignature) {
      if (group.length < 2) continue;

      const reportId = shortId();
      const report: DupReport = {
        id: reportId,
        kanalId: kanal.id,
        kanalNavn: kanal.name,
        signature: sig,
        meldinger: group
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .map(m => ({ messageId: m.id, ts: m.createdTimestamp, preview: (m.content || m.embeds[0]?.title || sig).slice(0, 80) })),
        opprettet: Date.now(),
      };

      dupReports.set(reportId, report);
      reports.push(report);

      logSystemEvent({
        source: 'duplicate_detector',
        event_type: 'DUPLICATE_MESSAGES_FOUND',
        title: `Duplikater funnet i #${kanal.name}: ${group.length} like meldinger`,
        severity: 'warning',
        metadata: { kanalId: kanal.id, kanalNavn: kanal.name, antall: group.length, signature: sig.slice(0, 80), reportId },
      });
    }
  }

  return reports;
}
