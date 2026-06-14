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
const useDeleteS3Object = vi.fn();
const uploadS3ObjectFromDisk = vi.fn();
const downloadS3ObjectToDisk = vi.fn();

vi.mock("@/services/fileDownload", () => ({
  uploadS3ObjectFromDisk: (...args: unknown[]) => uploadS3ObjectFromDisk(...args),
  downloadS3ObjectToDisk: (...args: unknown[]) => downloadS3ObjectToDisk(...args)
}));

vi.mock("@/hooks/useS3", () => ({
  useS3Buckets: (...args: unknown[]) => useS3Buckets(...args),
  useS3Objects: (...args: unknown[]) => useS3Objects(...args),
  useS3TextObject: (...args: unknown[]) => useS3TextObject(...args),
  useSaveS3TextObject: (...args: unknown[]) => useSaveS3TextObject(...args),
  useDeleteS3Object: (...args: unknown[]) => useDeleteS3Object(...args)
}));

describe("S3BrowserPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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
    useDeleteS3Object.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    uploadS3ObjectFromDisk.mockResolvedValue(undefined);
    downloadS3ObjectToDisk.mockResolvedValue(undefined);
  });

  it("edits the displayed S3 path directly and reverts invalid input", async () => {
    const user = userEvent.setup();

    render(<S3BrowserPage />);

    expect(screen.queryByPlaceholderText(/Bucket name/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open Bucket/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "logs-bucket" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "s3://logs-bucket/" }));

    expect(screen.getByText("s3://")).toBeInTheDocument();
    const pathInput = screen.getByDisplayValue("logs-bucket/");
    expect(pathInput).toHaveAttribute("list", "s3-path-options");
    expect(document.querySelector('option[value="data-bucket/"]')).toBeInTheDocument();

    await user.clear(pathInput);
    await user.type(pathInput, "data-bucket/{Enter}");

    expect(useS3Objects).toHaveBeenLastCalledWith("data-bucket", "");
    expect(screen.getByText("s3://data-bucket/")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "s3://data-bucket/" }));
    const invalidPathInput = screen.getByDisplayValue("data-bucket/");
    await user.clear(invalidPathInput);
    await user.type(invalidPathInput, "{Enter}");

    expect(useS3Objects).toHaveBeenLastCalledWith("data-bucket", "");
    expect(screen.getByText("s3://data-bucket/")).toBeInTheDocument();
  });

  it("remembers the last valid S3 path when the page is opened again", () => {
    localStorage.setItem("emr-eks:last-s3-path", JSON.stringify({ bucket: "logs-bucket", prefix: "logs/" }));

    render(<S3BrowserPage />);

    expect(useS3Objects).toHaveBeenLastCalledWith("logs-bucket", "logs/");
    expect(screen.getByText("s3://logs-bucket/logs/")).toBeInTheDocument();
  });

  it("compacts long displayed paths to the nearest parent levels", () => {
    localStorage.setItem("emr-eks:last-s3-path", JSON.stringify({ bucket: "logs-bucket", prefix: "year/month/day/run/" }));

    render(<S3BrowserPage />);

    expect(screen.getByRole("button", { name: "s3://logs-bucket/.../day/run/" })).toBeInTheDocument();
    expect(screen.queryByText("s3://logs-bucket/year/month/day/run/")).not.toBeInTheDocument();
  });

  it("shows only current directory entries, drills into folders, refreshes, and goes up", async () => {
    const user = userEvent.setup();

    render(<S3BrowserPage />);

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

    const refreshButton = screen.getByRole("button", { name: /^Refresh$/i });
    expect(refreshButton).not.toHaveTextContent(/Refresh/i);
    await user.click(refreshButton);
    expect(refetchObjects).toHaveBeenCalled();

    const upButton = screen.getByRole("button", { name: /^Up$/i });
    expect(upButton).not.toHaveTextContent(/Up/i);
    await user.click(upButton);

    expect(useS3Objects).toHaveBeenLastCalledWith("logs-bucket", "");
    expect(screen.getByText("s3://logs-bucket/")).toBeInTheDocument();
  });

  it("uploads and downloads objects through native file dialogs", async () => {
    const user = userEvent.setup();
    uploadS3ObjectFromDisk.mockResolvedValue({
      bucket: "logs-bucket",
      key: "logs/upload.txt",
      kind: "file",
      size: 12
    });
    downloadS3ObjectToDisk.mockResolvedValue("/tmp/readme.txt");

    render(<S3BrowserPage />);

    await user.click(screen.getByRole("button", { name: /^Upload$/i }));
    expect(uploadS3ObjectFromDisk).toHaveBeenCalledWith("logs-bucket", "");

    const browser = screen.getByRole("navigation", { name: /S3 objects/i });
    await user.click(within(browser).getByRole("button", { name: /readme\.txt/i }));
    await user.click(screen.getByRole("button", { name: /^Download$/i }));

    expect(downloadS3ObjectToDisk).toHaveBeenCalledWith("logs-bucket", "readme.txt");
  });
});

function objectsFor(bucket?: string, prefix?: string) {
  if (bucket === "logs-bucket" && prefix === "year/month/day/run/") {
    return [{ bucket, key: "year/month/day/run/stdout.log", kind: "file", size: 42 }];
  }

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
