export const WORKER_RESOURCES = Symbol('WORKER_RESOURCES');
export const WORKER_FATAL = Symbol('WORKER_FATAL');

export type FatalHandler = () => Promise<void>;
