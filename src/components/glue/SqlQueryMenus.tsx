import { History, LayoutTemplate, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SQL_DDL_TEMPLATES } from "@/services/glueSqlTemplates";
import type { SqlFavoriteEntry, SqlHistoryEntry } from "@/types/domain";

export function FavoriteNameDialog({
  open,
  onOpenChange,
  defaultName = "Saved query",
  onConfirm
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName?: string;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (open) {
      setName(defaultName);
    }
  }, [defaultName, open]);

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save to favorites</DialogTitle>
          <DialogDescription>Choose a name for this saved SQL query.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="favorite-name">Favorite name</Label>
          <Input
            id="favorite-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleConfirm();
              }
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!name.trim()} onClick={handleConfirm}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SqlTemplatesButton({ onSelect }: { onSelect: (sql: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="size-7" aria-label="SQL templates">
              <LayoutTemplate className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>SQL templates</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-56 p-1">
        <ul>
          {SQL_DDL_TEMPLATES.map((template) => (
            <li key={template.label}>
              <button
                type="button"
                className="w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => {
                  onSelect(template.sql);
                  setOpen(false);
                }}
              >
                {template.label}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function HistoryMenu({
  history,
  favoriteSqlSet,
  onSelect,
  onFavorite
}: {
  history: SqlHistoryEntry[];
  favoriteSqlSet: Set<string>;
  onSelect: (entry: SqlHistoryEntry) => void;
  onFavorite: (entry: SqlHistoryEntry) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="size-7" aria-label="Query history">
              <History className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Query history</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-[420px] p-0">
        {history.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No recent queries yet.</p>
        ) : (
          <ul className="max-h-72 overflow-auto divide-y">
            {history.map((entry) => {
              const isFavorited = favoriteSqlSet.has(entry.sql.trim());
              return (
                <li key={entry.id} className="flex items-start gap-1">
                  <button
                    type="button"
                    className="min-w-0 flex-1 px-3 py-2 text-left hover:bg-accent"
                    onClick={() => {
                      onSelect(entry);
                      setOpen(false);
                    }}
                  >
                    <p className="truncate font-mono text-xs">{entry.sql}</p>
                    <p className="text-[11px] text-muted-foreground">{new Date(entry.submittedAt).toLocaleString()}</p>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-1 size-7 shrink-0"
                    aria-label={isFavorited ? "Already in favorites" : "Add to favorites"}
                    title={isFavorited ? "Already in favorites" : "Add to favorites"}
                    disabled={isFavorited}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setOpen(false);
                      onFavorite(entry);
                    }}
                  >
                    <Star className={cn("size-3.5", isFavorited && "fill-current text-amber-500")} />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function FavoritesMenu({
  favorites,
  onSelect,
  onRemove
}: {
  favorites: SqlFavoriteEntry[];
  onSelect: (entry: SqlFavoriteEntry) => void;
  onRemove: (favoriteId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="size-7" aria-label="Saved favorites">
              <Star className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Saved favorites</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-[420px] p-0">
        {favorites.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No favorite queries yet.</p>
        ) : (
          <ul className="max-h-72 overflow-auto divide-y">
            {favorites.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2 px-3 py-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left hover:underline"
                  aria-label={entry.name}
                  onClick={() => {
                    onSelect(entry);
                    setOpen(false);
                  }}
                >
                  <p className="truncate text-sm font-medium">{entry.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{entry.sql}</p>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label={`Remove ${entry.name}`}
                  title="Remove favorite"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRemove(entry.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
