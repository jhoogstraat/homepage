import de from "@/i18n/de.json";
import en from "@/i18n/en.json";
import es from "@/i18n/es.json";

export const locales = ["de", "en", "es"] as const;
export type Locale = (typeof locales)[number];
export const messages = { de, en, es };
export const pages = ["home", "about", "homelab", "imprint", "privacy"] as const;
export type Page = (typeof pages)[number];

export function localePath(locale: Locale, page: Page): string {
  return `/${[locale === "de" ? "" : locale, page === "home" ? "" : page].filter(Boolean).join("/")}`;
}
