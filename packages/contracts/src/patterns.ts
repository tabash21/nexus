/**
 * Standard validation patterns for platform identifiers and Kafka topics.
 */
export const PLATFORM_PATTERN = /^[a-z][a-z0-9_-]{0,49}$/;
export const TOPIC_PATTERN = /^[a-zA-Z0-9._-]{1,249}$/;
