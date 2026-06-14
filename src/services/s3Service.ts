import type { S3JobLogObjectsRequest, S3TextObject } from "@/types/domain";
import { tauriClient } from "./tauriClient";

export const s3Service = {
  listBuckets: (accountId: string) => tauriClient.listS3Buckets({ accountId }),
  listObjects: (accountId: string, bucket: string, prefix?: string) =>
    tauriClient.listS3Objects({ accountId, bucket, prefix }),
  listJobLogObjects: (request: S3JobLogObjectsRequest) => tauriClient.listS3JobLogObjects(request),
  getJobLogObject: (accountId: string, bucket: string, key: string) =>
    tauriClient.getS3JobLogObject({ accountId, bucket, key }),
  getTextObject: (accountId: string, bucket: string, key: string) =>
    tauriClient.getS3TextObject({ accountId, bucket, key }),
  putTextObject: (object: S3TextObject) => tauriClient.putS3TextObject(object),
  uploadObject: (accountId: string, bucket: string, key: string, content: string) =>
    tauriClient.uploadS3Object({ accountId, bucket, key, content }),
  downloadObject: (accountId: string, bucket: string, key: string) =>
    tauriClient.downloadS3Object({ accountId, bucket, key }),
  deleteObject: (accountId: string, bucket: string, key: string) =>
    tauriClient.deleteS3Object({ accountId, bucket, key }),
  renameObject: (accountId: string, bucket: string, sourceKey: string, destinationKey: string) =>
    tauriClient.renameS3Object({ accountId, bucket, sourceKey, destinationKey })
};
