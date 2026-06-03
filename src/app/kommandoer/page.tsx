export default function Kommandoer() {
  const commands = [
    {
      name: '/live',
      description: 'Viser om GLENVEX er live akkurat nå.',
      usage: '/live',
    },
    {
      name: '/twitch',
      description: 'Sender Twitch-link i kanalen.',
      usage: '/twitch',
    },
    {
      name: '/promo',
      description: 'Genererer AI promo-tekst for aktiv stream.',
      usage: '/promo',
    },
    {
      name: '/setup',
      description: 'Setter opp anbefalt Discord-struktur (kanaler + roller).',
      usage: '/setup',
    },
    {
      name: '/status',
      description: 'Viser Twitch API, Discord Bot og systemstatus.',
      usage: '/status',
    },
    {
      name: '/socials',
      description: 'Viser alle sosiale medier for GLENVEX.',
      usage: '/socials',
    },
    {
      name: '/clip',
      description: 'Forklarer hvordan folk kan lage clips fra streamen.',
      usage: '/clip',
    },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">
          Kommandoer
        </h1>
        <p className="text-xs text-g-muted mt-0.5">
          Discord slash-kommandoer tilgjengelig i serveren
        </p>
      </div>

      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">
            Registrerte kommandoer
          </h2>
          <span className="text-xs text-g-green font-mono">{commands.length} totalt</span>
        </div>

        <div className="space-y-2">
          {commands.map((cmd) => (
            <div
              key={cmd.name}
              className="flex items-start gap-4 p-3 bg-g-bg border border-g-border rounded hover:border-g-green/20 transition-colors"
            >
              <code className="text-g-green font-mono font-bold text-sm flex-shrink-0 w-20">
                {cmd.name}
              </code>
              <div>
                <p className="text-xs text-g-text">{cmd.description}</p>
                <p className="text-[10px] text-g-muted font-mono mt-1">Bruk: {cmd.usage}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-3">
          Deploy kommandoer
        </h2>
        <p className="text-xs text-g-muted mb-3">
          Kjør følgende kommando for å registrere slash-kommandoer i Discord:
        </p>
        <div className="bg-g-bg border border-g-border rounded p-3 font-mono text-sm text-g-green">
          npm run bot:deploy
        </div>
        <p className="text-[10px] text-g-muted mt-2">
          Kommandoene blir globalt tilgjengelig etter ca. 1 time, eller umiddelbart på din server.
        </p>
      </div>
    </div>
  );
}
