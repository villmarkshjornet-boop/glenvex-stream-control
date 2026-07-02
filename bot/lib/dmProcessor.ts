/**
 * bot/lib/dmProcessor.ts
 *
 * Processes pending Discord DMs from the discord_dm_queue table.
 * Called on a 60-second interval from bot/index.ts after the Discord client is ready.
 */

import { Client } from 'discord.js';
import { getBotDb, WORKSPACE_ID } from './supabase';

export async function processPendingDMs(client: Client): Promise<void> {
  const sb = getBotDb();
  if (!sb) return;

  const wsId = WORKSPACE_ID;
  if (!wsId) return;

  const { data: pending } = await sb
    .from('discord_dm_queue')
    .select('*')
    .eq('workspace_id', wsId)
    .eq('status', 'pending')
    .lt('attempts', 3)
    .limit(10);

  if (!pending?.length) return;

  for (const dm of pending) {
    try {
      const user = await client.users.fetch(dm.discord_id).catch(() => null);
      if (!user) throw new Error('User not found');
      await user.send(dm.message);
      await sb
        .from('discord_dm_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          attempts: dm.attempts + 1,
        })
        .eq('id', dm.id);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      const newAttempts = dm.attempts + 1;
      await sb
        .from('discord_dm_queue')
        .update({
          status: newAttempts >= 3 ? 'failed' : 'pending',
          attempts: newAttempts,
          error: errMsg,
        })
        .eq('id', dm.id);
    }
  }
}
