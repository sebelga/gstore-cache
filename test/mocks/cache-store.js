'use strict';

const redis = require('redis-mock');

const client = redis.createClient();

const getCallback = (...args) => args.pop();

module.exports = (name = 'memory') => ({
    store: {
        name,
        options: {},
        getClient: () => client,
        reset: (...args) => getCallback(...args)(),
        set: (...args) => getCallback(...args)(),
        mset: (...args) => getCallback(...args)(),
        get: (...args) => getCallback(...args)(),
        mget: (...args) => getCallback(...args)(),
    },
});
