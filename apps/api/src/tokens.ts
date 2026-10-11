import type { repository } from '@nexus/database';
export type DocumentRepository = ReturnType<typeof repository>;
export const DOCUMENT_REPOSITORY = Symbol('DOCUMENT_REPOSITORY');
export const API_TOKEN = Symbol('API_TOKEN');
export const CLOSE_DATABASE = Symbol('CLOSE_DATABASE');

