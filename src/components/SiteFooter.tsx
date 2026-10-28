import Link from "next/link";
export default function SiteFooter() {
  return <footer className="mm-footer" aria-label="Ayuda e información">
    <span>MusMatch · A la mesa</span>
    <nav aria-label="Ayuda y condiciones">
      <Link href="/help/">Ayuda</Link><Link href="/privacy/">Privacidad</Link><Link href="/terms/">Condiciones</Link>
    </nav>
  </footer>;
}
