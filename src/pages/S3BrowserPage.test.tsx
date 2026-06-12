import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { S3BrowserPage } from "./S3BrowserPage";
import { useSessionStore } from "@/stores/sessionStore";

const refetchObjects = vi.fn();
const useS3Buckets = vi.fn();
const useS3Objects = vi.fn();
const useS3TextObject = vi.fn();
const useSaveS3TextObject = vi.fn();
const useUploadS3Object = vi.fn();
const useDownloadS3Object = vi.fn();
const useDeleteS3Object = vi.fn();

vi.mock("@/hooks/useS3", () => ({
  useS3Buckets: (...args: unknown[]) => useS3Buckets(...args),
  useS3Objects: (...args: unknown[]) => useS3Objects(...args),
  useS3TextObject: (...args: unknown[]) => useS3TextObject(...args),
  useSaveS3TextObject: (...args: unknown[]) => useSaveS3TextObject(...args),
  useUploadS3Object: (...args: unknown[]) => useUploadS3Object(...args),
  useDownloadS3Object: (...args: unknown[]) => useDownloadS3Object(...args),
  useDeleteS3Object: (...args: unknown[]) => useDeleteS3Object(...args)
}));

describe("S3BrowserPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      selectedS3Bucket: undefined,
      selectedS3Prefix: undefined
    });
    useS3Buckets.mockReturnValue({
      data: [
        { name: "logs-bucket", createdAt: "2026-06-10T00:00:00Z" },
        { name: "data-bucket", createdAt: "2026-06-10T00:00:00Z" }
      ],
      isLoading: false,
      error: null
    });
    useS3Objects.mockImplementation((bucket?: string, prefix?: string) => ({
      data: objectsFor(bucket, prefix),
      isLoading: false,
      error: null,
      refetch: refetchObjects
    }));
    useS3TextObject.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null
    });
    useSaveS3TextObject.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    useUploadS3Object.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    useDownloadS3Object.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    useDeleteS3Object.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  });

  it("lets users type or autocomplete a bucket name and keeps browsing inside that bucket", async () => {
    const user = userEvent.setup();

    render(<S3BrowserPage />);

    const bucketInput = screen.getByPlaceholderText(/Bucket name/i);
    expect(bucketInput).toHaveAttribute("list", "s3-bucket-options");
    expect(document.querySelector('option[value="logs-bucket"]')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "logs-bucket" })).not.toBeInTheDocument();

    await user.clear(bucketInput);
    await user.type(bucketInput, "data-bucket");
    await user.click(screen.getByRole("button", { name: /Open Bucket/i }));

    expect(useS3Objects).toHaveBeenLastCalledWith("data-bucket", "");
    expect(screen.getByText("s3://data-bucket/")).toBeInTheDocument();
  });

  it("shows only current directory entries, drills into folders, refreshes, and goes up", async () => {
    const user = userEvent.setup();

    render(<S3BrowserPage />);

    await user.clear(screen.getByPlaceholderText(/Bucket name/i));
    await user.type(screen.getByPlaceholderText(/Bucket name/i), "logs-bucket");
    await user.click(screen.getByRole("button", { name: /Open Bucket/i }));

    const browser = screen.getByRole("navigation", { name: /S3 objects/i });
    expect(within(browser).getByRole("button", { name: /logs\//i })).toBeInTheDocument();
    expect(within(browser).getByRole("button", { name: /readme\.txt/i })).toBeInTheDocument();
    expect(screen.queryByText("logs/readme.txt")).not.toBeInTheDocument();

    await user.click(within(browser).getByRole("button", { name: /logs\//i }));

    expect(useS3Objects).toHaveBeenLastCalledWith("logs-bucket", "logs/");
    expect(screen.getByText("s3://logs-bucket/logs/")).toBeInTheDocument();
    expect(within(browser).getByRole("button", { name: /app\//i })).toBeInTheDocument();
    expect(within(browser).getByRole("button", { name: /stdout\.log/i })).toBeInTheDocument();
    expect(screen.queryByText("logs/stdout.log")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Refresh/i }));
    expect(refetchObjects).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^Up$/i }));

    expect(useS3Objects).toHaveBeenLastCalledWith("logs-bucket", "");
    expect(screen.getByText("s3://logs-bucket/")).toBeInTheDocument();
  });
});

function objectsFor(bucket?: string, prefix?: string) {
  if (bucket === "data-bucket") {
    return [{ bucket, key: "dataset.csv", kind: "file", size: 120 }];
  }

  if (bucket === "logs-bucket" && prefix === "logs/") {
    return [
      { bucket, key: "logs/app/", kind: "folder", size: 0 },
      { bucket, key: "logs/stdout.log", kind: "file", size: 42 }
    ];
  }

  if (bucket === "logs-bucket") {
    return [
      { bucket, key: "logs/", kind: "folder", size: 0 },
      { bucket, key: "readme.txt", kind: "file", size: 10 }
    ];
  }

  return [];
}
