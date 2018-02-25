'use strict';

const EventEmitter = require('events');
const nodeCacheManager = require('cache-manager');
const arrify = require('arrify');
const extend = require('extend');

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
        queries: 5, // 5 seconds
        stores: {
            memory: {
                keys: 60 * 5, // 5 minutes
                queries: 5,
            },
            redis: {
                keys: 60 * 60 * 24, // 1 day
                queries: 0, // infinite
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
        this._ds = undefined;
    }

    init(_config) {
        const self = this;

        if (typeof _config === 'undefined' && typeof this._cacheManager !== 'undefined') {
            ready();
            return;
        }

        this._ds = (_config && _config.datastore) || this._ds;

        const config = _config && _config.config;

        /**
         * Forward methods to cacheManager
         */
        const bindCacheManagerMethods = () => {
            this.get = this.cacheManager.get;
            this.mget = this.cacheManager.mget;
            this.set = this.cacheManager.set;
            this.mset = this.cacheManager.mset;
            this.del = this.cacheManager.del;
            this.reset = this.cacheManager.reset;
        };

        const proceed = () => {
            if (typeof config === 'undefined') {
                this._config = Object.assign({}, defaultConfig);
            } else {
                const ttlConfig = extend(true, {}, config.ttl || {}); // make a copy before merging
                this._config = Object.assign({}, defaultConfig, config);
                extend(true, this._config.ttl, defaultConfig.ttl, ttlConfig);
            }
            if (this._config.stores.length > 1) {
                this._config.stores = this._config.stores.map(store => nodeCacheManager.caching(store));

                this._cacheManager = nodeCacheManager.multiCaching(this._config.stores);
                this._config.stores.forEach(cache => {
                    self._redisClient = self._redisClient || checkRedis(cache);
                });
            } else {
                this._cacheManager = nodeCacheManager.caching(this._config.stores[0]);
                this._redisClient = this._redisClient || checkRedis(this._cacheManager);
            }

            bindCacheManagerMethods();

            ready();
        };

        if (typeof this._cacheManager !== 'undefined') {
            this.deleteCacheManager(proceed);
        } else {
            proceed();
        }

        function ready() {
            process.nextTick(() => {
                self.emit('ready');
            });
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

    get ds() {
        return this._ds;
    }
}

const init = config => {
    if (typeof gstoreCacheInstance === 'undefined') {
        gstoreCacheInstance = new GstoreCache();

        gstoreCacheInstance.keys = gstoreCacheKeys(gstoreCacheInstance);
        gstoreCacheInstance.queries = gstoreCacheQueries(gstoreCacheInstance);
        gstoreCacheInstance.utils = utils;
    }

    gstoreCacheInstance.init(config);

    return gstoreCacheInstance;
};

const instance = () => gstoreCacheInstance;

module.exports = {
    init,
    instance,
    utils,
};
