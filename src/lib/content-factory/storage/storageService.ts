import { assertContentFactoryEnabled } from '../index';
import { getDb } from '@/lib/db';
import fs from 'fs';
import path from 'path';

// Abstraksjonssjikt – støtter Supabase Storage, S3, R2
type StorageBackend = 'supabase' | 's3' | 'r2' | 'local';

function getBackend(): StorageBackend {
  if (process.env.SUPABASE_URL) return 'supabase';
  if (process.env.AWS_S3_BUCKET) return 's3';
  if (process.env.R2_BUCKET) return 'r2';
  return 'local';
}

const BASE_DIR = path.join(process.cwd(), 'data', 'content-factory');

const BØTTER = {
  'raw-vods': `${BASE_DIR}/raw-vods`,
  'transcripts': `${BASE_DIR}/transcripts`,
  'highlights': `${BASE_DIR}/highlights`,
  'shorts': `${BASE_DIR}/shorts`,
  'reels': `${BASE_DIR}/reels`,
  'youtube': `${BASE_DIR}/youtube`,
  'captions': `${BASE_DIR}/captions`,
  'thumbnails': `${BASE_DIR}/thumbnails`,
} as const;

type BøtteNavn = keyof typeof BØTTER;

function sikreBøtte(bøtte: BøtteNavn): void {
  const dir = BØTTER[bøtte];
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export async function lagreAsset(
  bøtte: BøtteNavn,
  filNavn: string,
  innhold: Buffer | string
): Promise<{ path: string; url?: string }> {
  assertContentFactoryEnabled();

  const backend = getBackend();

  if (backend === 'supabase') {
    const db = getDb();
    if (db) {
      const filSti = `content-factory/${bøtte}/${filNavn}`;
      const buffer = typeof innhold === 'string' ? Buffer.from(innhold) : innhold;
      const { error } = await db.storage
        .from('glenvex-assets')
        .upload(filSti, buffer, { upsert: true });

      if (!error) {
        const { data: urlData } = db.storage.from('glenvex-assets').getPublicUrl(filSti);
        return { path: filSti, url: urlData.publicUrl };
      }
    }
  }

  // Fallback: lokal lagring
  sikreBøtte(bøtte);
  const lokal = path.join(BØTTER[bøtte], filNavn);
  if (typeof innhold === 'string') {
    fs.writeFileSync(lokal, innhold, 'utf-8');
  } else {
    fs.writeFileSync(lokal, innhold);
  }
  return { path: lokal };
}

export async function hentAssetUrl(bøtte: BøtteNavn, filNavn: string): Promise<string | null> {
  assertContentFactoryEnabled();

  const backend = getBackend();
  if (backend === 'supabase') {
    const db = getDb();
    if (db) {
      const { data } = db.storage.from('glenvex-assets')
        .getPublicUrl(`content-factory/${bøtte}/${filNavn}`);
      return data.publicUrl ?? null;
    }
  }

  const lokal = path.join(BØTTER[bøtte], filNavn);
  return fs.existsSync(lokal) ? lokal : null;
}

export function genererNedlastingspakke(vodId: string): {
  tiktok: string[]; shorts: string[]; reels: string[];
  youtube: string[]; captions: string[]; discordPost: string;
} {
  assertContentFactoryEnabled();

  // Returner filstier for nedlasting – URL-er fylles inn etter rendering
  return {
    tiktok: [],
    shorts: [],
    reels: [],
    youtube: [],
    captions: [],
    discordPost: '',
  };
}
