export type Locale = "ru" | "kk";
export const translations = {
  ru: {
    home: "Главная",
    office: "Виртуальный офис",
    materials: "Материалы",
    rup: "РУП",
    history: "История",
  },
  kk: {
    home: "Басты бет",
    office: "Виртуалды кеңсе",
    materials: "Материалдар",
    rup: "Оқу жоспары",
    history: "Тарих",
  },
};
export type Tab = keyof typeof translations.ru;
// UI vocabulary is isolated here for incremental Kazakh localization.
