import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { S3TextObject } from "@/types/domain";
import { s3Service } from "@/services/s3Service";

export function useS3Buckets() {
  return useQuery({
    queryKey: ["s3-buckets"],
    queryFn: s3Service.listBuckets
  });
}

export function useS3Objects(bucket?: string, prefix?: string) {
  return useQuery({
    queryKey: ["s3-objects", bucket, prefix],
    queryFn: () => s3Service.listObjects(bucket!, prefix),
    enabled: Boolean(bucket)
  });
}

export function useS3TextObject(bucket?: string, key?: string) {
  return useQuery({
    queryKey: ["s3-text-object", bucket, key],
    queryFn: () => s3Service.getTextObject(bucket!, key!),
    enabled: Boolean(bucket && key)
  });
}

export function useSaveS3TextObject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (object: S3TextObject) => s3Service.putTextObject(object),
    onSuccess: (object) => {
      queryClient.setQueryData(["s3-text-object", object.bucket, object.key], object);
      queryClient.invalidateQueries({ queryKey: ["s3-objects", object.bucket] });
    }
  });
}
