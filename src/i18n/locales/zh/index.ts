import ai from "@/i18n/locales/zh/ai";
import common from "@/i18n/locales/zh/common";
import dashboard from "@/i18n/locales/zh/dashboard";
import dbhub from "@/i18n/locales/zh/dbhub";
import help from "@/i18n/locales/zh/help";
import jobHistory from "@/i18n/locales/zh/jobHistory";
import logs from "@/i18n/locales/zh/logs";
import navigation from "@/i18n/locales/zh/navigation";
import s3 from "@/i18n/locales/zh/s3";
import secrets from "@/i18n/locales/zh/secrets";
import settings from "@/i18n/locales/zh/settings";
import submitJob from "@/i18n/locales/zh/submitJob";
import templates from "@/i18n/locales/zh/templates";
import type { TranslationDictionary } from "@/i18n/types";

/**
 * Keys are the exact English source strings, so an entry missing here renders in
 * English rather than as a bare key. Shards keep each review batch readable;
 * `shards.test.ts` guards against two of them defining one key differently.
 *
 * `common` first: it holds the shared vocabulary, and a feature shard that
 * re-defines one of its keys deliberately wins.
 */
export const shards: Record<string, TranslationDictionary> = {
  common,
  navigation,
  help,
  submitJob,
  jobHistory,
  logs,
  s3,
  dbhub,
  dashboard,
  templates,
  ai,
  secrets,
  settings
};

export const zh: TranslationDictionary = Object.assign({}, ...Object.values(shards));
