/**
 * QuestService — daily and weekly quests.
 * Seeds default quests per workspace. Tracks progress and rewards.
 * Period resets automatically (daily at midnight, weekly on Monday).
 */

import { getBotDb } from './supabase';
import { awardCoins } from './coinService';

export interface QuestDef {
  questKey:        string;
  questName:       string;
  description:     string;
  questType:       'daily' | 'weekly';
  objectiveType:   string;
  objectiveTarget: number;
  rewardXp:        number;
  rewardCoins:     number;
}

const DEFAULT_QUESTS: QuestDef[] = [
  // Daily
  { questKey: 'daily_chat_5',       questName: 'Daglig snakker',       description: 'Send 5 meldinger i dag',          questType: 'daily',  objectiveType: 'messages',      objectiveTarget: 5,   rewardXp: 20,  rewardCoins: 10  },
  { questKey: 'daily_chat_20',      questName: 'Aktiv i dag',          description: 'Send 20 meldinger i dag',         questType: 'daily',  objectiveType: 'messages',      objectiveTarget: 20,  rewardXp: 50,  rewardCoins: 25  },
  { questKey: 'daily_voice_30',     questName: 'Voice-tid',            description: 'Vær 30 min i voice channel',      questType: 'daily',  objectiveType: 'voice_minutes', objectiveTarget: 30,  rewardXp: 40,  rewardCoins: 20  },
  { questKey: 'daily_game_1',       questName: 'Gamer',                description: 'Spill ett casino-spill',          questType: 'daily',  objectiveType: 'games_played',  objectiveTarget: 1,   rewardXp: 15,  rewardCoins: 5   },
  { questKey: 'daily_reaction_5',   questName: 'Reaksjonær',           description: 'Reager på 5 meldinger',           questType: 'daily',  objectiveType: 'reactions',     objectiveTarget: 5,   rewardXp: 15,  rewardCoins: 5   },
  // Weekly
  { questKey: 'weekly_chat_100',    questName: 'Ukens chatter',        description: 'Send 100 meldinger denne uken',   questType: 'weekly', objectiveType: 'messages',      objectiveTarget: 100, rewardXp: 200, rewardCoins: 100 },
  { questKey: 'weekly_voice_2h',    questName: 'Voice-dedikert',       description: 'Vær 2 timer i voice denne uken',  questType: 'weekly', objectiveType: 'voice_minutes', objectiveTarget: 120, rewardXp: 150, rewardCoins: 75  },
  { questKey: 'weekly_game_5',      questName: 'Casino-uke',           description: 'Spill 5 casino-spill denne uken', questType: 'weekly', objectiveType: 'games_played',  objectiveTarget: 5,   rewardXp: 100, rewardCoins: 50  },
  { questKey: 'weekly_coins_1000',  questName: 'Økonom',               description: 'Tjen 1000 coins denne uken',      questType: 'weekly', objectiveType: 'coins_earned',  objectiveTarget: 1000,rewardXp: 300, rewardCoins: 0   },
];

function getPeriodStart(questType: 'daily' | 'weekly'): string {
  const now = new Date();
  if (questType === 'daily') {
    return now.toISOString().slice(0, 10);
  }
  // Weekly: Monday of current week
  const day  = now.getDay(); // 0=Sun, 1=Mon...
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().slice(0, 10);
}

export async function seedDefaultQuests(workspaceId: string): Promise<void> {
  const db = getBotDb();
  if (!db) return;

  const { count } = await db
    .from('community_quests')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  if ((count ?? 0) > 0) return;

  const rows = DEFAULT_QUESTS.map(q => ({
    workspace_id:     workspaceId,
    quest_key:        q.questKey,
    quest_name:       q.questName,
    description:      q.description,
    quest_type:       q.questType,
    objective_type:   q.objectiveType,
    objective_target: q.objectiveTarget,
    reward_xp:        q.rewardXp,
    reward_coins:     q.rewardCoins,
    is_active:        true,
  }));

  const { error } = await db.from('community_quests').insert(rows);
  if (error) console.error('[QuestService] seedDefaultQuests failed:', error.message);
}

export interface QuestProgress {
  questKey:        string;
  questName:       string;
  description:     string;
  questType:       'daily' | 'weekly';
  progress:        number;
  objectiveTarget: number;
  completed:       boolean;
  rewardClaimed:   boolean;
  rewardXp:        number;
  rewardCoins:     number;
}

export async function getMemberQuests(
  workspaceId: string,
  discordId:   string,
  questType:   'daily' | 'weekly' | 'all' = 'all',
): Promise<QuestProgress[]> {
  const db = getBotDb();
  if (!db) return [];

  // Get active quests
  const questQuery = db
    .from('community_quests')
    .select('quest_key,quest_name,description,quest_type,objective_target,reward_xp,reward_coins')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);

  if (questType !== 'all') questQuery.eq('quest_type', questType);

  const { data: quests } = await questQuery;
  if (!quests || quests.length === 0) return [];

  // Get progress for current periods
  const dailyPeriod  = getPeriodStart('daily');
  const weeklyPeriod = getPeriodStart('weekly');

  const { data: progress } = await db
    .from('community_member_quests')
    .select('quest_key,progress,completed,reward_claimed,period_start')
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId)
    .or(`period_start.eq.${dailyPeriod},period_start.eq.${weeklyPeriod}`);

  const progressMap = new Map(
    (progress ?? []).map(p => [`${p.quest_key as string}_${p.period_start as string}`, p]),
  );

  return quests.map(q => {
    const period = (q.quest_type as string) === 'daily' ? dailyPeriod : weeklyPeriod;
    const p      = progressMap.get(`${q.quest_key as string}_${period}`);
    return {
      questKey:        q.quest_key as string,
      questName:       q.quest_name as string,
      description:     q.description as string,
      questType:       q.quest_type as 'daily' | 'weekly',
      progress:        (p?.progress as number | undefined) ?? 0,
      objectiveTarget: q.objective_target as number,
      completed:       (p?.completed as boolean | undefined) ?? false,
      rewardClaimed:   (p?.reward_claimed as boolean | undefined) ?? false,
      rewardXp:        q.reward_xp as number,
      rewardCoins:     q.reward_coins as number,
    };
  });
}

/** Increment quest progress. Called from message/voice/game event handlers. */
export async function incrementQuestProgress(
  workspaceId:   string,
  discordId:     string,
  objectiveType: string,
  amount:        number = 1,
): Promise<void> {
  const db = getBotDb();
  if (!db) return;

  // Check if quests enabled
  const { data: flags } = await db
    .from('workspace_feature_flags')
    .select('quests_enabled')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if ((flags?.quests_enabled as boolean | null) === false) return;

  // Find matching active quests
  const { data: quests } = await db
    .from('community_quests')
    .select('quest_key,quest_type,objective_target,reward_xp,reward_coins')
    .eq('workspace_id', workspaceId)
    .eq('objective_type', objectiveType)
    .eq('is_active', true);

  if (!quests || quests.length === 0) return;

  for (const quest of quests) {
    const questType   = quest.quest_type as 'daily' | 'weekly';
    const periodStart = getPeriodStart(questType);
    const target      = quest.objective_target as number;

    // Upsert progress
    const { data: existing } = await db
      .from('community_member_quests')
      .select('id,progress,completed,reward_claimed')
      .eq('workspace_id', workspaceId)
      .eq('discord_id', discordId)
      .eq('quest_key', quest.quest_key as string)
      .eq('period_start', periodStart)
      .maybeSingle();

    if (existing) {
      if (existing.completed as boolean) continue;

      const newProgress = Math.min((existing.progress as number) + amount, target);
      const nowComplete = newProgress >= target;

      await db.from('community_member_quests').update({
        progress:     newProgress,
        completed:    nowComplete,
        completed_at: nowComplete ? new Date().toISOString() : null,
      }).eq('id', existing.id as string);

      if (nowComplete && !(existing.reward_claimed as boolean)) {
        await claimQuestReward(workspaceId, discordId, quest.quest_key as string, periodStart, quest.reward_xp as number, quest.reward_coins as number);
      }
    } else {
      const initProgress = Math.min(amount, target);
      const nowComplete  = initProgress >= target;

      await db.from('community_member_quests').insert({
        workspace_id:   workspaceId,
        discord_id:     discordId,
        quest_key:      quest.quest_key as string,
        progress:       initProgress,
        completed:      nowComplete,
        completed_at:   nowComplete ? new Date().toISOString() : null,
        reward_claimed: false,
        period_start:   periodStart,
      });

      if (nowComplete) {
        await claimQuestReward(workspaceId, discordId, quest.quest_key as string, periodStart, quest.reward_xp as number, quest.reward_coins as number);
      }
    }
  }
}

async function claimQuestReward(
  workspaceId: string,
  discordId:   string,
  questKey:    string,
  periodStart: string,
  rewardXp:    number,
  rewardCoins: number,
): Promise<void> {
  const db = getBotDb();
  if (!db) return;

  await db.from('community_member_quests').update({ reward_claimed: true })
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId)
    .eq('quest_key', questKey)
    .eq('period_start', periodStart);

  if (rewardCoins > 0) {
    await awardCoins(discordId, rewardCoins, 'milestone_card', { workspaceId, questKey });
  }

  if (rewardXp > 0) {
    const { data: m } = await db
      .from('community_members')
      .select('xp')
      .eq('workspace_id', workspaceId)
      .eq('discord_id', discordId)
      .maybeSingle();
    if (m) {
      await db.from('community_members')
        .update({ xp: ((m.xp as number | null) ?? 0) + rewardXp })
        .eq('workspace_id', workspaceId)
        .eq('discord_id', discordId);
    }
  }
}
