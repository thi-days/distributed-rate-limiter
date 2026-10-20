-- Decimal strings preserve fractional token balances in Redis replies.
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + tonumber(time[2]) / 1000
local state = redis.call('HMGET', KEYS[1], 'tokens', 'last_refill')
local tokens = capacity
local previous = now
if state[1] or state[2] then
    tokens = tonumber(state[1])
    previous = tonumber(state[2])
    if not tokens or not previous or tokens < 0 or tokens > capacity then
        return redis.error_reply('Invalid bucket state')
    end
end
now = math.max(now, previous)
tokens = math.min(capacity, tokens + (now - previous) * rate / 60000)
local allowed = 0
if tokens >= 1 then
    allowed = 1
    tokens = tokens - 1
end
redis.call('HSET', KEYS[1], 'tokens', string.format('%.17g', tokens), 'last_refill', string.format('%.17g', now))
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity * 60000 / rate))
return {allowed, string.format('%.17g', tokens)}
