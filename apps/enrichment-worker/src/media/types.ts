import type { ClaimedMediaJob, MediaFailure, MediaWriteResult } from '@nexus/database';
import type { DownloadedMedia } from './files.js';

export interface MediaResources {
  temporaryScope: string;
  cleanupTemporary(): Promise<void>;
  claim(): Promise<ClaimedMediaJob[]>;
  renew(job: ClaimedMediaJob): Promise<boolean>;
  checkpoint(job: ClaimedMediaJob, uri: string): Promise<MediaWriteResult>;
  complete(job: ClaimedMediaJob, text: string): Promise<MediaWriteResult>;
  fail(job: ClaimedMediaJob, failure: MediaFailure): Promise<MediaWriteResult>;
  download(url: string, directory: string, signal: AbortSignal): Promise<DownloadedMedia>;
  archive(job: ClaimedMediaJob, media: DownloadedMedia, signal: AbortSignal): Promise<string>;
  readArchive(job: ClaimedMediaJob, directory: string, signal: AbortSignal): Promise<DownloadedMedia>;
  ocr(media: DownloadedMedia, directory: string, signal: AbortSignal): Promise<string>;
  ready(): Promise<void>;
  close(): void;
}
