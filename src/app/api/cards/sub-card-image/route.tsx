import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const displayName    = searchParams.get('displayName')    ?? 'Subscriber';
  const twitchUsername = searchParams.get('twitchUsername') ?? '';
  const tier           = searchParams.get('tier')           ?? '1000';

  const tierLabel = tier === '3000' ? 'TIER 3' : tier === '2000' ? 'TIER 2' : 'TIER 1';
  const tierColor = tier === '3000' ? '#FFD700' : tier === '2000' ? '#C0C0C0' : '#CD7F32';

  return new ImageResponse(
    (
      <div
        style={{
          width:          '400px',
          height:         '560px',
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'space-between',
          background:     'linear-gradient(160deg, #0D0D1A 0%, #1A0929 50%, #0D0D1A 100%)',
          border:         '2px solid #9146FF',
          borderRadius:   '16px',
          padding:        '24px 20px',
          position:       'relative',
          fontFamily:     'system-ui, sans-serif',
          overflow:       'hidden',
        }}
      >
        {/* Glow effect */}
        <div style={{
          position:     'absolute',
          top:          '-40px',
          left:         '50%',
          transform:    'translateX(-50%)',
          width:        '200px',
          height:       '200px',
          background:   'radial-gradient(circle, rgba(145,70,255,0.3) 0%, transparent 70%)',
          borderRadius: '50%',
          display:      'flex',
        }} />

        {/* Header */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', zIndex: 1 }}>
          <div style={{
            fontSize:      '11px',
            letterSpacing: '3px',
            color:         '#9146FF',
            fontWeight:    700,
            textTransform: 'uppercase',
          }}>
            GLENVEX COMMUNITY
          </div>
          <div style={{
            fontSize:   '22px',
            fontWeight: 900,
            color:      '#FFFFFF',
            letterSpacing: '1px',
          }}>
            TWITCH SUB
          </div>
        </div>

        {/* Center badge */}
        <div style={{
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            '12px',
          zIndex:         1,
        }}>
          <div style={{
            width:          '120px',
            height:         '120px',
            borderRadius:   '50%',
            background:     'linear-gradient(135deg, #9146FF 0%, #6420CC 100%)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            fontSize:       '60px',
            border:         '3px solid rgba(145,70,255,0.6)',
            boxShadow:      '0 0 30px rgba(145,70,255,0.4)',
          }}>
            ⭐
          </div>

          <div style={{
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            gap:            '6px',
          }}>
            <div style={{
              fontSize:    '28px',
              fontWeight:  800,
              color:       '#FFFFFF',
              textAlign:   'center',
              lineHeight:  1.1,
            }}>
              {displayName}
            </div>
            {twitchUsername && (
              <div style={{ fontSize: '13px', color: '#9146FF', fontWeight: 600 }}>
                twitch.tv/{twitchUsername}
              </div>
            )}
          </div>
        </div>

        {/* Tier badge + rarity */}
        <div style={{
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          gap:            '10px',
          zIndex:         1,
          width:          '100%',
        }}>
          <div style={{
            background:    `linear-gradient(90deg, transparent, ${tierColor}22, transparent)`,
            border:        `1px solid ${tierColor}66`,
            borderRadius:  '20px',
            padding:       '6px 24px',
            fontSize:      '13px',
            fontWeight:    700,
            color:         tierColor,
            letterSpacing: '2px',
          }}>
            {tierLabel}
          </div>

          {/* Bottom stats row */}
          <div style={{
            display:         'flex',
            justifyContent:  'space-between',
            width:           '100%',
            padding:         '10px 8px 0',
            borderTop:       '1px solid rgba(145,70,255,0.3)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <div style={{ fontSize: '9px', color: '#666', letterSpacing: '1px', textTransform: 'uppercase' }}>Rarity</div>
              <div style={{ fontSize: '12px', color: '#9146FF', fontWeight: 700 }}>⭐ Sub</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: '9px', color: '#666', letterSpacing: '1px', textTransform: 'uppercase' }}>Klasse</div>
              <div style={{ fontSize: '12px', color: '#FFFFFF', fontWeight: 600 }}>Subscriber</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <div style={{ fontSize: '9px', color: '#666', letterSpacing: '1px', textTransform: 'uppercase' }}>Type</div>
              <div style={{ fontSize: '12px', color: '#FFFFFF', fontWeight: 600 }}>Community</div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width:  400,
      height: 560,
    },
  );
}
