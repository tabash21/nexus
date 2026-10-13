import type { repository } from '@nexus/database';
export type ItemRepository = ReturnType<typeof repository>;
export const ITEM_REPOSITORY = Symbol('ITEM_REPOSITORY');
export const API_TOKEN = Symbol('API_TOKEN');
export const CLOSE_DATABASE = Symbol('CLOSE_DATABASE');

