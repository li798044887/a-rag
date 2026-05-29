from arq.connections import RedisSettings

from app.config import settings


def redis_settings() -> RedisSettings:
    redis = RedisSettings.from_dsn(settings.redis_url)
    redis.conn_timeout = 10
    redis.conn_retries = 10
    redis.conn_retry_delay = 2
    redis.retry_on_timeout = True
    return redis
