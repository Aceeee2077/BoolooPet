// ============================================================================
// Renderer i18n for the lightweight pages.
//
// A global script like lite-image.ts / lite-file-reaction.ts, so the other lite
// scripts call liteT() directly — no imports and no bundler.
//
// The dictionary itself stays in src/shared/i18n.ts: the Rust side embeds it
// (src-tauri/src/i18n.rs) and hands it over through the `i18n_get` command, so
// there is exactly one place where strings live. The active locale is
// config.locale, except that the backend first resolves the `system`
// preference against the OS language; the renderer only ever sees the result,
// and switching it re-fetches here.
// ============================================================================

type LiteTranslateParams = Record<string, string | number>;

let liteLocale: Locale = 'zh';
let liteDictionary: Record<string, I18nValue> = {};

/** Translate a key; unknown keys fall back to the key itself. */
function liteT(key: string, params?: LiteTranslateParams): string {
  const value = liteDictionary[key];
  if (typeof value !== 'string') return key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
}

/** Translate an array-valued key (see the speech-line arrays in the dictionary). */
function liteTArray(key: string): string[] {
  const value = liteDictionary[key];
  return Array.isArray(value) ? value.map(String) : [key];
}

function liteCurrentLocale(): Locale {
  return liteLocale;
}

/** Apply a dictionary and retranslate every element marked with data-i18n*. */
function liteSetLocaleData(locale: Locale, dict: Record<string, I18nValue>): void {
  liteLocale = locale === 'en' ? 'en' : 'zh';
  liteDictionary = dict && typeof dict === 'object' ? dict : {};
  document.documentElement.lang = liteLocale === 'en' ? 'en' : 'zh-CN';
  liteApplyStaticText();
}

/**
 * Translate the static markup:
 *   data-i18n="key"        → textContent
 *   data-i18n-label="key"  → aria-label
 *   data-i18n-placeholder="key" → placeholder
 *   data-i18n-title="key"  → title
 *
 * Elements whose text is built by script keep their key list in the script and
 * are refreshed by the page's own render function instead.
 */
function liteApplyStaticText(root: ParentNode = document): void {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n]'))) {
    element.textContent = liteT(element.dataset.i18n as string);
  }
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n-label]'))) {
    element.setAttribute('aria-label', liteT(element.dataset.i18nLabel as string));
  }
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]'))) {
    element.setAttribute('placeholder', liteT(element.dataset.i18nPlaceholder as string));
  }
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n-title]'))) {
    element.setAttribute('title', liteT(element.dataset.i18nTitle as string));
  }
}

/** Fetch the active locale + dictionary from the backend. */
async function liteLoadDictionary(): Promise<void> {
  const payload = await window.api.getI18n();
  liteSetLocaleData(payload.locale, payload.dict);
}
