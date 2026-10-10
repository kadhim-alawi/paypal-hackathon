/**
 * Fixed applicant-facing copy in English and Spanish. Conversational replies come
 * from the AI in whatever language the person writes; these are the system notes,
 * labels and fallbacks around them. Staff-facing text stays in English.
 */
export const say = (language: string | null | undefined, en: string, es: string): string =>
  language === "es" ? es : en;
