import pino from 'pino';
export const createLogger = (level: string) => pino({ level, redact: { paths: ['req.headers.authorization', '*.code', '*.refreshToken', '*.idToken', '*.password'], censor: '[redacted]' } });
export type Logger = ReturnType<typeof createLogger>;
export const LOGGER = Symbol('LOGGER');
