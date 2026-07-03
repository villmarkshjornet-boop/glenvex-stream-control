/**
 * AchievementService — track and unlock achievements.
 * Seeds default achievements per workspace at first boot.
 * Checks unlock conditions after member stat updates.
 * Notifies unnotified achievements on /profil or via background check.
 */

import { getBotDb } from './supabase';
import { awardCoins } from './coinService';

export interface AchievementDef {
  achievementKey:  string;
  achievementName: string;
  description:     string;
  icon:            string;
  category:        'social' | 'games' | 'economy' | 'loyalty' | 'general';
  unlockCondition: { type: string; threshold: number };
  rewardXp:        number;
  rewardCoins:     number;
  isSecret:        boolean;
}

const DEFAULT_ACHIEVEMENTS: AchievementDef[] = [
  // Social
  { achievementKey: 'first_message',    achievementName: 'Første ord',          description: 'Send din første melding',                 icon: '💬', category: 'social',  unlockCondition: { type: 'messages', threshold: 1    }, rewardXp: 10,  rewardCoins: 5,   isSecret: false },
  { achievementKey: 'chatty_100',       achievementName: 'Pratsom',             description: '100 meldinger sendt',                     icon: '🗨️',  category: 'social',  unlockCondition: { type: 'messages', threshold: 100  }, rewardXp: 50,  rewardCoins: 25,  isSecret: false },
  { achievementKey: 'chatty_1000',      achievementName: 'Snakkesalig',         description: '1000 meldinger sendt',                    icon: '💬', category: 'social',  unlockCondition: { type: 'messages', threshold: 1000 }, rewardXp: 200, rewardCoins: 100, isSecret: false },
  { achievementKey: 'raider_1',         achievementName: 'Første raid',         description: 'Delta i ditt første raid',                icon: '⚔️',  category: 'social',  unlockCondition: { type: 'raids',    threshold: 1    }, rewardXp: 30,  rewardCoins: 15,  isSecret: false },
  { achievementKey: 'raider_10',        achievementName: 'Raid-veteran',        description: 'Delta i 10 raids',                        icon: '🛡️',  category: 'social',  unlockCondition: { type: 'raids',    threshold: 10   }, rewardXp: 150, rewardCoins: 75,  isSecret: false },
  // Loyalty
  { achievementKey: 'level_10',         achievementName: 'Level 10',            description: 'Nå level 10',                             icon: '🔰', category: 'loyalty', unlockCondition: { type: 'level',    threshold: 10   }, rewardXp: 0,   rewardCoins: 50,  isSecret: false },
  { achievementKey: 'level_50',         achievementName: 'Halvveis',            description: 'Nå level 50',                             icon: '⭐', category: 'loyalty', unlockCondition: { type: 'level',    threshold: 50   }, rewardXp: 0,   rewardCoins: 250, isSecret: false },
  { achievementKey: 'level_100',        achievementName: 'Maxed Out',           description: 'Nå level 100',                            icon: '👑', category: 'loyalty', unlockCondition: { type: 'level',    threshold: 100  }, rewardXp: 0,   rewardCoins: 1000,isSecret: false },
  { achievementKey: 'prestige_1',       achievementName: 'Prestige I',          description: 'Oppnå ditt første prestige',              icon: '⭐', category: 'loyalty', unlockCondition: { type: 'prestige', threshold: 1    }, rewardXp: 0,   rewardCoins: 500, isSecret: false },
  { achievementKey: 'streak_7',         achievementName: 'Uke-dedikert',        description: '7-dagers streak',                         icon: '🔥', category: 'loyalty', unlockCondition: { type: 'streak',   threshold: 7    }, rewardXp: 100, rewardCoins: 50,  isSecret: false },
  { achievementKey: 'streak_30',        achievementName: 'En hel måned',        description: '30-dagers streak',                        icon: '🔥', category: 'loyalty', unlockCondition: { type: 'streak',   threshold: 30   }, rewardXp: 500, rewardCoins: 250, isSecret: false },
  // Economy
  { achievementKey: 'coins_1000',       achievementName: 'Sparegris',           description: 'Tjen 1000 coins totalt',                  icon: '🐷', category: 'economy', unlockCondition: { type: 'total_coins_earned', threshold: 1000  }, rewardXp: 50,  rewardCoins: 0,   isSecret: false },
  { achievementKey: 'coins_10000',      achievementName: 'Finansgeni',          description: 'Tjen 10 000 coins totalt',                icon: '💰', category: 'economy', unlockCondition: { type: 'total_coins_earned', threshold: 10000 }, rewardXp: 200, rewardCoins: 0,   isSecret: false },
  // Games
  { achievementKey: 'first_blackjack',  achievementName: 'Første Blackjack',    description: 'Spill ditt første blackjack-parti',       icon: '🃏', category: 'games',   unlockCondition: { type: 'blackjack_games', threshold: 1  }, rewardXp: 20,  rewardCoins: 10,  isSecret: false },
  { achievementKey: 'first_roulette',   achievementName: 'Første Spin',         description: 'Spill din første roulette',               icon: '🎡', category: 'games',   unlockCondition: { type: 'roulette_bets',   threshold: 1  }, rewardXp: 20,  rewardCoins: 10,  isSecret: false },
  // Secret
  { achievementKey: 'hero_of_the_day',  achievementName: 'Dagens Helt',         description: 'Bli valgt som Hero of the Day',           icon: '🦸', category: 'social',  unlockCondition: { type: 'hero_count', threshold: 1 }, rewardXp: 200, rewardCoins: 100, isSecret: false },
  { achievementKey: 'h4ck_master',      achievementName: '??? ',                description: 'Hemmelig achievement',                    icon: '⚡', category: 'general', unlockCondition: { type: 'has_badge', threshold: 1, badge: 'h4ckerman' } as unknown as { type: string; threshold: number }, rewardXp: 500, rewardCoins: 500, isSecret: true },
];

export async function seedDefaultAchievements(workspaceId: string): Promise<void> {
  const db = getBotDb();
  if (!db) return;

  const { count } = await db
    .from('community_achievements')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  if ((count ?? 0) > 0) return;

  const rows = DEFAULT_ACHIEVEMENTS.map(a => ({
    workspace_id:      workspaceId,
    achievement_key:   a.achievementKey,
    achievement_name:  a.achievementName,
    description:       a.description,
    icon:              a.icon,
    category:          a.category,
    unlock_condition:  a.unlockCondition,
    reward_xp:         a.rewardXp,
    reward_coins:      a.rewardCoins,
    is_secret:         a.isSecret,
  }));

  const { error } = await db.from('community_achievements').insert(rows);
  if (error) console.error('[AchievementService] seedDefaultAchievements failed:', error.message);
}

export interface MemberStats {
  messages:          number;
  raids:             number;
  level:             number;
  prestigeLevel:     number;
  streakDays:        number;
  totalCoinsEarned:  number;
  heroCount:         number;
  blackjackGames:    number;
  rouletteBets:      number;
  badges:            string[];
}

export interface UnlockedAchievement {
  achievementKey:  string;
  achievementName: string;
  icon:            string;
  rewardXp:        number;
  rewardCoins:     number;
}

/** Check all achievements and unlock any newly eligible ones. Returns newly unlocked. */
export async function checkAndUnlockAchievements(
  workspaceId: string,
  discordId:   string,
  stats:       MemberStats,
): Promise<UnlockedAchievement[]> {
  const db = getBotDb();
  if (!db) return [];

  // Check if feature enabled
  const { data: flags } = await db
    .from('workspace_feature_flags')
    .select('achievements_enabled')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if ((flags?.achievements_enabled as boolean | null) === false) return [];

  // Get all achievements for workspace
  const { data: all } = await db
    .from('community_achievements')
    .select('achievement_key,achievement_name,icon,unlock_condition,reward_xp,reward_coins')
    .eq('workspace_id', workspaceId);

  if (!all) return [];

  // Get already unlocked
  const { data: existing } = await db
    .from('community_member_achievements')
    .select('achievement_key')
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId);

  const owned = new Set((existing ?? []).map(r => r.achievement_key as string));
  const newlyUnlocked: UnlockedAchievement[] = [];

  for (const ach of all) {
    if (owned.has(ach.achievement_key as string)) continue;

    const condition = ach.unlock_condition as { type: string; threshold: number; badge?: string };
    let qualifies = false;

    switch (condition.type) {
      case 'messages':           qualifies = stats.messages         >= condition.threshold; break;
      case 'raids':              qualifies = stats.raids            >= condition.threshold; break;
      case 'level':              qualifies = stats.level            >= condition.threshold; break;
      case 'prestige':           qualifies = stats.prestigeLevel    >= condition.threshold; break;
      case 'streak':             qualifies = stats.streakDays       >= condition.threshold; break;
      case 'total_coins_earned': qualifies = stats.totalCoinsEarned >= condition.threshold; break;
      case 'hero_count':         qualifies = stats.heroCount        >= condition.threshold; break;
      case 'blackjack_games':    qualifies = stats.blackjackGames   >= condition.threshold; break;
      case 'roulette_bets':      qualifies = stats.rouletteBets     >= condition.threshold; break;
      case 'has_badge':          qualifies = condition.badge ? stats.badges.includes(condition.badge) : false; break;
    }

    if (!qualifies) continue;

    // Unlock it
    const { error } = await db.from('community_member_achievements').insert({
      workspace_id:    workspaceId,
      discord_id:      discordId,
      achievement_key: ach.achievement_key as string,
      notified:        false,
    });

    if (error && error.code !== '23505') {
      console.error('[AchievementService] unlock failed:', error.message);
      continue;
    }

    // Grant rewards
    if ((ach.reward_coins as number) > 0) {
      await awardCoins(discordId, ach.reward_coins as number, 'achievement_card', {
        workspaceId, achievementKey: ach.achievement_key,
      });
    }

    newlyUnlocked.push({
      achievementKey:  ach.achievement_key as string,
      achievementName: ach.achievement_name as string,
      icon:            ach.icon as string,
      rewardXp:        ach.reward_xp as number,
      rewardCoins:     ach.reward_coins as number,
    });
  }

  return newlyUnlocked;
}

export interface MemberAchievement {
  achievementKey:  string;
  achievementName: string;
  description:     string;
  icon:            string;
  category:        string;
  unlockedAt:      string;
  rewardXp:        number;
  rewardCoins:     number;
}

export async function getMemberAchievements(
  workspaceId: string,
  discordId:   string,
): Promise<MemberAchievement[]> {
  const db = getBotDb();
  if (!db) return [];

  const { data, error } = await db
    .from('community_member_achievements')
    .select('achievement_key,unlocked_at')
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId)
    .order('unlocked_at', { ascending: false });

  if (error || !data || data.length === 0) return [];

  const keys = data.map(r => r.achievement_key as string);
  const { data: defs } = await db
    .from('community_achievements')
    .select('achievement_key,achievement_name,description,icon,category,reward_xp,reward_coins')
    .eq('workspace_id', workspaceId)
    .in('achievement_key', keys);

  const defMap = new Map((defs ?? []).map(d => [d.achievement_key as string, d]));

  return data.map(r => {
    const def = defMap.get(r.achievement_key as string);
    return {
      achievementKey:  r.achievement_key as string,
      achievementName: (def?.achievement_name as string | undefined) ?? r.achievement_key as string,
      description:     (def?.description as string | undefined) ?? '',
      icon:            (def?.icon as string | undefined) ?? '🏆',
      category:        (def?.category as string | undefined) ?? 'general',
      unlockedAt:      r.unlocked_at as string,
      rewardXp:        (def?.reward_xp as number | undefined) ?? 0,
      rewardCoins:     (def?.reward_coins as number | undefined) ?? 0,
    };
  });
}

/** Returns unlocked + total achievement counts for a member. */
export async function getAchievementCounts(
  workspaceId: string,
  discordId:   string,
): Promise<{ unlocked: number; total: number }> {
  const db = getBotDb();
  if (!db) return { unlocked: 0, total: 0 };
  const [{ count: total }, { count: unlocked }] = await Promise.all([
    db.from('community_achievements')        .select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
    db.from('community_member_achievements') .select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('discord_id', discordId),
  ]);
  return { unlocked: unlocked ?? 0, total: total ?? 0 };
}

/** Mark all unnotified achievements as notified for a member. */
export async function markAchievementsNotified(workspaceId: string, discordId: string): Promise<void> {
  const db = getBotDb();
  if (!db) return;
  await db
    .from('community_member_achievements')
    .update({ notified: true })
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId)
    .eq('notified', false);
}
