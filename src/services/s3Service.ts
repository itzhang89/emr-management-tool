import type { S3JobLogObjectsRequest, S3TextObject } from "@/types/domain";
import { tauriClient } from "./tauriClient";

export const s3Service = {
  listBuckets: () => tauriClient.listS3Buckets(),
  listObjects: (bucket: string, prefix?: string) => tauriClient.listS3Objects({ bucket, prefix }),
  listJobLogObjects: (request: S3JobLogObjectsRequest) => tauriClient.listS3JobLogObjects(request),
  getJobLogObject: (bucket: string, key: string) => tauriClient.getS3JobLogObject({ bucket, key }),
  getTextObject: (bucket: string, key: string) => tauriClient.getS3TextObject({ bucket, key }),
  putTextObject: (object: S3TextObject) => tauriClient.putS3TextObject(object),
  uploadObject: (bucket: string, key: string, content: string) => tauriClient.uploadS3Object({ bucket, key, content }),
  downloadObject: (bucket: string, key: string) => tauriClient.downloadS3Object({ bucket, key }),
  deleteObject: (bucket: string, key: string) => tauriClient.deleteS3Object({ bucket, key })
};
