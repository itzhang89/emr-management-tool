import { groupKeyboardShortcutsByCategory } from "@/data/keyboardShortcuts";
import { KeyboardShortcutKey } from "@/components/help/KeyboardShortcutKey";

export function ShortcutsReferenceList() {
  const groups = groupKeyboardShortcutsByCategory();

  return (
    <div className="space-y-6">
      {groups.map(({ category, shortcuts }) => (
        <section key={category.id} className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">{category.label}</h3>
            {category.description ? <p className="text-xs text-muted-foreground">{category.description}</p> : null}
          </div>
          <div className="divide-y rounded-md border">
            {shortcuts.map((shortcut) => (
              <div key={shortcut.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{shortcut.label}</p>
                  <p className="text-xs text-muted-foreground">{shortcut.description}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {shortcut.keys.map((key, index) => (
                    <span key={`${shortcut.id}-${key}-${index}`} className="inline-flex items-center gap-1.5">
                      {index > 0 ? <span className="text-xs text-muted-foreground">or</span> : null}
                      <KeyboardShortcutKey>{key}</KeyboardShortcutKey>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
