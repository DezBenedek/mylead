import { openUrl } from "@tauri-apps/plugin-opener";

/** "okosurlap.hu" -> "https://okosurlap.hu", a sémával kezdődőt változatlanul hagyja. */
export function normalizeExternalUrl(raw: string): string {
  const t = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface OpenExternalResult {
  ok: boolean;
  /** Emberi olvasásra szánt hibaok (diagnosztikához megjelenítjük). */
  error?: string;
}

/**
 * Külső URL megnyitása a rendszer böngészőjében.
 * Tauri-ban a sima `<a target="_blank">` nem működik, ezért az opener plugin kell;
 * böngészőben futva sima új fülre esik vissza.
 */
export async function openExternalUrl(raw: string | null | undefined): Promise<OpenExternalResult> {
  if (!raw || !raw.trim()) return { ok: false, error: "Üres URL." };
  const url = normalizeExternalUrl(raw);
  try {
    if (isTauriRuntime()) {
      await openUrl(url);
    } else if (typeof window !== "undefined") {
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) return { ok: false, error: "A böngésző blokkolta a felugró ablakot." };
    }
    return { ok: true };
  } catch (e) {
    // Pl. régi app-bináris (opener plugin nélkül) vagy hiányzó capability.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
