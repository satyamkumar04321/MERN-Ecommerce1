const { createClient } = require('redis');

let redisClient = null;

if (process.env.REDIS_HOSTED_URL) {
    redisClient = createClient({
        url: process.env.REDIS_HOSTED_URL
    });

    redisClient.on('error', (err) => console.warn('⚠️ Redis Client Error (non-fatal):', err.message));

    redisClient.connect()
        .then(() => {
            console.log('🐘 Redis client connected successfully!');
        })
        .catch((err) => {
            console.warn('⚠️ Redis connection failed (non-fatal, caching disabled):', err.message);
            redisClient = null;
        });
} else {
    console.warn('⚠️ REDIS_HOSTED_URL not set — Redis caching is disabled.');
}

// Provide a no-op fallback so callers don't crash
const safeRedisClient = new Proxy({}, {
    get(_, prop) {
        if (redisClient && typeof redisClient[prop] !== 'undefined') {
            return redisClient[prop].bind ? redisClient[prop].bind(redisClient) : redisClient[prop];
        }
        // Return a no-op async function for any redis method
        return async () => null;
    }
});

module.exports = safeRedisClient;