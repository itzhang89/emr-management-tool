import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useS3Buckets, useS3Objects } from "@/hooks/useS3";
import {
  appendSlashForMatching,
  formatPathInput,
  formatS3Path,
  listS3PathOptions,
  listS3PathSuggestions,
  parentPrefix,
  parsePathInputForSuggestions,
  parseS3PathInput,
  resolvePathInputEnterAction
} from "@/services/s3PathUtils";

export function useS3PathPicker({
  open,
  initialPath,
  appendSubmitUser
}: {
  open: boolean;
  initialPath: string;
  appendSubmitUser?: boolean;
}) {
  const buckets = useS3Buckets();
  const [pathInput, setPathInput] = useState("");
  const [appendUser, setAppendUser] = useState(appendSubmitUser ?? false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const parsed = parseS3PathInput(initialPath);
    const fallbackBucket = parsed?.bucket ?? buckets.data?.[0]?.name;
    setPathInput(formatPathInput(fallbackBucket, parsed?.prefix ?? ""));
    setAppendUser(appendSubmitUser ?? false);
    setHighlightIndex(-1);
    setSuggestionsOpen(false);
  }, [open, initialPath, buckets.data, appendSubmitUser]);

  const context = useMemo(() => parsePathInputForSuggestions(pathInput), [pathInput]);
  const folderObjects = useS3Objects(
    open && context.mode === "folder" ? context.bucket : undefined,
    context.mode === "folder" ? context.parentPrefix : undefined
  );

  const bucketNames = useMemo(() => (buckets.data ?? []).map((entry) => entry.name), [buckets.data]);

  const options = useMemo(
    () => listS3PathOptions(context, bucketNames, folderObjects.data ?? []),
    [context, bucketNames, folderObjects.data]
  );

  const suggestions = useMemo(() => listS3PathSuggestions(options), [options]);

  const parsedPathInput = useMemo(() => parseS3PathInput(pathInput), [pathInput]);
  const browsePath = context.mode === "folder" ? formatS3Path(context.bucket, context.parentPrefix) : "s3://";
  const currentPath = formatS3Path(parsedPathInput?.bucket, parsedPathInput?.prefix ?? "");

  const isLoading = context.mode === "bucket" ? buckets.isLoading : folderObjects.isLoading;
  const error = context.mode === "bucket" ? buckets.error : folderObjects.error;
  const canGoUp = context.mode === "folder" && Boolean(context.parentPrefix);

  const navigateTo = useCallback((raw: string, mode: "commit" | "continue") => {
    const parsed = parseS3PathInput(mode === "commit" ? raw : appendSlashForMatching(raw));
    if (!parsed) {
      toast.error("Enter a valid S3 path like bucket/folder/");
      return false;
    }
    setPathInput(formatPathInput(parsed.bucket, parsed.prefix));
    setSuggestionsOpen(mode === "continue");
    setHighlightIndex(-1);
    return true;
  }, []);

  const selectOption = useCallback(
    (optionPathInput: string) => {
      navigateTo(optionPathInput, "continue");
    },
    [navigateTo]
  );

  const submitPathInput = useCallback(
    (raw: string) => {
      const action = resolvePathInputEnterAction(raw, suggestions.length);
      if (action === "select-suggestion") {
        selectOption(suggestions[0]);
        return;
      }
      if (action === "navigate") {
        navigateTo(raw, "continue");
        return;
      }
      setSuggestionsOpen(true);
    },
    [navigateTo, selectOption, suggestions]
  );

  const goUp = useCallback(() => {
    if (context.mode !== "folder" || !context.parentPrefix) return;
    const parent = parentPrefix(context.parentPrefix);
    setPathInput(formatPathInput(context.bucket, parent));
    setSuggestionsOpen(true);
    setHighlightIndex(-1);
  }, [context]);

  const handlePathKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (!suggestionsOpen && (event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length > 0) {
        event.preventDefault();
        setSuggestionsOpen(true);
        setHighlightIndex(event.key === "ArrowDown" ? 0 : suggestions.length - 1);
        return;
      }

      if (!suggestionsOpen || suggestions.length === 0) {
        if (event.key === "Enter") {
          event.preventDefault();
          submitPathInput(event.currentTarget.value);
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightIndex((current) => (current + 1) % suggestions.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
          selectOption(suggestions[highlightIndex]);
          return;
        }
        submitPathInput(event.currentTarget.value);
        return;
      }

      if (event.key === "Escape") {
        setSuggestionsOpen(false);
        setHighlightIndex(-1);
      }
    },
    [highlightIndex, selectOption, submitPathInput, suggestions, suggestionsOpen]
  );

  const onPathInputChange = useCallback((value: string) => {
    setPathInput(value);
    setSuggestionsOpen(true);
    setHighlightIndex(-1);
  }, []);

  return {
    pathInput,
    appendUser,
    setAppendUser,
    highlightIndex,
    suggestionsOpen,
    setSuggestionsOpen,
    context,
    options,
    suggestions,
    browsePath,
    currentPath,
    parsedPathInput,
    isLoading,
    error,
    canGoUp,
    navigateTo,
    selectOption,
    goUp,
    handlePathKeyDown,
    onPathInputChange
  };
}
