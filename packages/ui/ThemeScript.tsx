// Runs synchronously while <head> is parsed, so the saved theme / motion choice applies before
// the first paint. data-js lets the CSS hide reveal-on-scroll content only when JS can reveal it.
const SCRIPT =
  "(function(){var d=document.documentElement;d.setAttribute('data-js','');try{" +
  "var t=localStorage.getItem('ad-theme');if(t==='light'||t==='dark')d.setAttribute('data-theme',t);" +
  "if(localStorage.getItem('ad-motion')==='off')d.setAttribute('data-motion','off')}catch(e){}})()"

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
}
