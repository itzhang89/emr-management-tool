import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { S3TextObject } from "@/types/domain";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { s3Service } from "@/services/s3Service";

function useActiveAccountId() {
  const activeAccount = useActiveAwsAccount();
  return activeAccount.data?.id;
}

export function useS3Buckets() {
  const accountId = useActiveAccountId();

  return useQuery({
    queryKey: ["s3-buckets", accountId],
    queryFn: () => s3Service.listBuckets(accountId!),
    enabled: Boolean(accountId)
  });
}

export function useS3Objects(bucket?: string, prefix?: string) {
  const accountId = useActiveAccountId();

  return useQuery({
    queryKey: ["s3-objects", accountId, bucket, prefix],
    queryFn: () => s3Service.listObjects(accountId!, bucket!, prefix),
    enabled: Boolean(accountId && bucket)
  });
}

export function useS3TextObject(bucket?: string, key?: string) {
  const accountId = useActiveAccountId();

  return useQuery({
    queryKey: ["s3-text-object", accountId, bucket, key],
    queryFn: () => s3Service.getTextObject(accountId!, bucket!, key!),
    enabled: Boolean(accountId && bucket && key)
  });
}

export function useSaveS3TextObject() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (object: S3TextObject) =>
      s3Service.putTextObject({ ...object, accountId: object.accountId ?? accountId }),
    onSuccess: (object) => {
      queryClient.setQueryData(["s3-text-object", accountId, object.bucket, object.key], object);
      void queryClient.invalidateQueries({ queryKey: ["s3-objects", accountId, object.bucket] });
    }
  });
}

export function useUploadS3Object() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bucket, key, content }: { bucket: string; key: string; content: string }) =>
      s3Service.uploadObject(accountId!, bucket, key, content),
    onSuccess: (object) => {
      void queryClient.invalidateQueries({ queryKey: ["s3-objects", accountId, object.bucket] });
    }
  });
}

export function useDownloadS3Object() {
  const accountId = useActiveAccountId();

  return useMutation({
    mutationFn: ({ bucket, key }: { bucket: string; key: string }) =>
      s3Service.downloadObject(accountId!, bucket, key)
  });
}

export function useDeleteS3Object() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bucket, key }: { bucket: string; key: string }) =>
      s3Service.deleteObject(accountId!, bucket, key),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["s3-objects", accountId, variables.bucket] });
      queryClient.removeQueries({ queryKey: ["s3-text-object", accountId, variables.bucket, variables.key] });
    }
  });
}

export function useCreateS3Folder() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      bucket,
      parentPrefix,
      folderName
    }: {
      bucket: string;
      parentPrefix?: string;
      folderName: string;
    }) => s3Service.createFolder(accountId!, bucket, parentPrefix, folderName),
    onSuccess: (object) => {
      void queryClient.invalidateQueries({ queryKey: ["s3-objects", accountId, object.bucket] });
    }
  });
}

export function useDeleteS3Prefix() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bucket, key }: { bucket: string; key: string }) =>
      s3Service.deletePrefix(accountId!, bucket, key),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["s3-objects", accountId, variables.bucket] });
      queryClient.removeQueries({ queryKey: ["s3-text-object", accountId, variables.bucket] });
    }
  });
}

export function useRenameS3Object() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      bucket,
      sourceKey,
      destinationKey
    }: {
      bucket: string;
      sourceKey: string;
      destinationKey: string;
    }) => s3Service.renameObject(accountId!, bucket, sourceKey, destinationKey),
    onSuccess: (object) => {
      void queryClient.invalidateQueries({ queryKey: ["s3-objects", accountId, object.bucket] });
    }
  });
}
