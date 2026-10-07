import type { QuanteModule } from '@/content/assetra/modules'

// Animated mini-UIs of the Quante modules (the product cards of the design). Pure CSS
// animation; decorative, hidden from assistive tech.

export function ModuleVisual({ slug }: { slug: QuanteModule['slug'] }) {
  switch (slug) {
    case 'generate':
      return (
        <div className="pv" aria-hidden="true">
          <div className="term">
            <span className="tl">$ quante new &quot;e-shop s keramikou&quot;</span>
            <span className="tl ok" style={{ animationDelay: '.9s' }}>✓ kategorie a produkty</span>
            <span className="tl ok" style={{ animationDelay: '1.6s' }}>✓ platby a doprava</span>
            <span className="tl ok" style={{ animationDelay: '2.3s' }}>✓ nasazeno</span>
          </div>
          <div className="qm">
            <i className="top" />
            <i style={{ animationDelay: '.15s' }} />
            <i style={{ animationDelay: '.3s' }} />
            <i style={{ animationDelay: '.45s' }} />
            <i style={{ animationDelay: '.6s' }} />
          </div>
        </div>
      )
    case 'qscan':
      return (
        <div className="pv" aria-hidden="true">
          <div className="doc">
            <i className="t" /><i /><i className="s" /><i /><i className="h" /><i /><i className="s" /><i /><i className="h h2" /><i className="s" /><i /><i />
            <span className="scan" />
          </div>
          <span className="stripe" style={{ top: 'auto', bottom: 16 }}>Ve vývoji</span>
          <span className="urlb">vas-eshop.cz</span>
          <span className="flag mt" style={{ top: 104 }}>kategorie</span>
          <span className="flag mt g2" style={{ top: 164 }}>produkty a ceny</span>
        </div>
      )
    case 'qgent':
      return (
        <div className="pv" aria-hidden="true">
          <span className="stripe">Ve vývoji</span>
          <div className="chat">
            <div className="bub a"><small>Qgent</small>Na úvodní stránce chybí informace o dopravě. Mám ji doplnit?</div>
            <div className="acts" style={{ animationDelay: '.9s' }}><span>Potvrdit</span><span>Upravit</span></div>
            <div className="bub a" style={{ animationDelay: '1.8s' }}><small>Qgent</small>Hotovo. Změnu jde kdykoli vrátit.</div>
          </div>
        </div>
      )
    case 'qdit':
      return (
        <div className="pv" aria-hidden="true">
          <div className="ed">
            <div className="tb"><span>Aa</span><span>B</span><span>↕</span><span>AI</span></div>
            <i className="hd" />
            <div className="sel">Doprava zdarma nad 999 Kč<em /></div>
            <i />
            <i style={{ width: '80%' }} />
            <i style={{ width: '55%' }} />
          </div>
        </div>
      )
    case 'qads':
      return (
        <div className="pv" aria-hidden="true">
          <div className="ads">
            <span className="v"><em>9:16</em></span>
            <span className="s" style={{ animationDelay: '-2s' }}><em>1:1</em></span>
            <span className="w" style={{ animationDelay: '-4s' }}><em>16:9</em></span>
            <b>Stáhnout</b>
          </div>
        </div>
      )
    case 'qails':
      return (
        <div className="pv" aria-hidden="true">
          <span className="stripe">Ve vývoji</span>
          <div className="kt" style={{ top: 52 }}>
            <div className="cmd">› hledat ve všech obchodech</div>
            <div className="kr"><span><em className="st">zrno.cz</em>Objednávka #2042</span><b>nová</b></div>
            <div className="kr" style={{ animationDelay: '.4s' }}><span><em className="st">keramika.cz</em>Dotaz na doručení</span><b>nová</b></div>
            <div className="kr" style={{ animationDelay: '.8s' }}><span><em className="st">zrno.cz</em>Reklamace</span><b>vyřízeno</b></div>
          </div>
        </div>
      )
  }
}
