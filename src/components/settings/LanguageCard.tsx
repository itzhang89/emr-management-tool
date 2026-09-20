import { Languages } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { resolveSystemLocale, setLanguagePreference, useLanguagePreference, useT } from "@/i18n";
import type { LanguagePreference } from "@/services/languagePreferences";

/**
 * `中文` and `English` are language endonyms and are deliberately not routed
 * through `t()`: someone who can only read Chinese has to be able to find their
 * way back to it.
 */
export function LanguageCard() {
  const t = useT();
  const preference = useLanguagePreference();
  const systemLabel = resolveSystemLocale() === "zh" ? "中文" : "English";

  return (
    <Card>
      <CardHeader className="p-4 2xl:p-5">
        <CardTitle className="flex items-center gap-2 text-base 2xl:text-lg">
          <Languages className="size-4 2xl:size-[18px]" />
          {t("Language")}
        </CardTitle>
        <CardDescription className="text-xs 2xl:text-sm">
          {t("Choose the language used by the app interface. Error messages and log output stay in English.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 2xl:p-5 2xl:pt-0">
        <RadioGroup
          aria-label={t("Language")}
          value={preference}
          onValueChange={(value) => setLanguagePreference(value as LanguagePreference)}
          className="flex flex-col gap-2"
        >
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <RadioGroupItem value="system" />
            {t("Follow system language")}
            <span className="text-xs text-muted-foreground">({systemLabel})</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <RadioGroupItem value="zh" />
            中文
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <RadioGroupItem value="en" />
            English
          </label>
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
