'use strict';

const EventEmitter = require('events');
const nodeCacheManager = require('cache-manager');
const arrify = require('arrify');

const gstoreCacheKeys = require('./keys');
const gstoreCacheQueries = require('./queries');
const utils = require('./utils');

const defaultConfig = {
    stores: [
        {
            store: 'memory',
            max: 100,
        },
    ],
    ttl: {
        keys: 60 * 10, // 10 minutes
        queries: 60, // 1 minute
        stores: {
            memory: {
                keys: 60 * 5, // 5 minutes
                queries: 60,
            },
            redis: {
                keys: 60 * 60 * 24, // 1 day
                queries: 60 * 60, // 1 hour
            },
        },
    },
    cachePrefix: {
        keys: 'gck:', // Gstore Cache Key
        queries: 'gcq:', // Gstore Cache Query
    },
    global: true,
};

/**
 * Check if the cache is "redis"
 * If it is, we save the client to be able
 * to better cache queries.
 */
const checkRedis = cache => {
    let client;
    if (cache.store.name === 'redis') {
        client = cache.store.getClient();
    }
    return client;
};

let gstoreCacheInstance;

class GstoreCache extends EventEmitter {
    constructor() {
        super();

        this._config = Object.assign({}, defaultConfig);
        this._cacheManager = undefined;
        this._redisClient = undefined;
    }

    init(_config) {
        const self = this;

        /**
         * Forward methods to cacheManager
         */
        const bindCacheManagerMethods = () => {
            self.get = self.cacheManager.get;
            self.mget = self.cacheManager.mget;
            self.set = self.cacheManager.set;
            self.mset = self.cacheManager.mset;
            self.del = self.cacheManager.del;
        };

        const proceed = () => {
            this._config =
                _config === true ? Object.assign({}, defaultConfig) : Object.assign({}, defaultConfig, _config);
            if (this._config.stores.length > 1) {
                this._cacheManager = nodeCacheManager.multiCaching(this._config.stores);
                this._config.stores.forEach(cache => {
                    self._redisClient = self._redisClient || checkRedis(cache);
                });
            } else {
                this._cacheManager = nodeCacheManager.caching(this._config.stores[0]);
                this._redisClient = this._redisClient || checkRedis(this._cacheManager);
            }

            bindCacheManagerMethods();

            process.nextTick(() => {
                self.emit('ready');
            });
        };

        if (typeof _config !== 'undefined') {
            if (typeof this._cacheManager !== 'undefined') {
                this.deleteCacheManager(proceed);
            } else {
                proceed();
            }
        }
    }

    /**
     * Concatenate key|value pairs and
     * call mset on the cacheManager
     */
    primeCache(_keys, _values, options = {}) {
        let keys = _keys;
        let values;
        if (!Array.isArray(_keys)) {
            keys = [_keys];
            /**
             * If _keys passed is not an Array but "_values" is,
             * we want to keep it that way...
             */
            if (Array.isArray(_values)) {
                values = [_values];
            }
        }
        values = values || arrify(_values);

        const keysValues = keys.reduce((acc, key, index) => [...acc, key, values[index]], []);
        const args = [...keysValues, options];
        return this._cacheManager
            .mset(...args)
            .then(response => (response && response.length === 1 ? response[0] : response));
    }

    deleteCacheManager(cb) {
        const self = this;
        if (this._cacheManager) {
            return this._cacheManager.reset(() => {
                if (self._redisClient) {
                    self._redisClient.end(true);
                    self._redisClient = undefined;
                }
                self._cacheManager = undefined;

                cb();
            });
        }
        return cb();
    }

    get config() {
        return this._config;
    }

    get redisClient() {
        return this._redisClient;
    }

    get cacheManager() {
        return this._cacheManager;
    }
}

module.exports = config => {
    if (typeof gstoreCacheInstance === 'undefined') {
        gstoreCacheInstance = new GstoreCache();

        gstoreCacheInstance.keys = gstoreCacheKeys(gstoreCacheInstance);
        gstoreCacheInstance.queries = gstoreCacheQueries(gstoreCacheInstance);
        gstoreCacheInstance.utils = utils;
    }

    gstoreCacheInstance.init(config);

    return gstoreCacheInstance;
};
