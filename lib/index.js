'use strict';

const ds = require('@google-cloud/datastore')();
const nodeCacheManager = require('cache-manager');
const arrify = require('arrify');

const utils = require('./utils');

const { dsKeytoString } = utils.datastore;

const defaultConfig = {
    stores: [
        {
            store: 'memory',
            max: 100,
            ttl: 60 * 10, // 10 minutes
        },
    ],
    ttl: {
        keys: 60 * 10, // 10 minutes
        queries: 60, // 1 minute
    },
};

let _cacheManager;
let _redisClient;
let _ttlConfig;

const ttl = () => _ttlConfig;
const getRedisClient = () => _redisClient;
const getCacheManager = () => _cacheManager;

const deleteCacheManager = cb => {
    if (_cacheManager) {
        return _cacheManager.reset(() => {
            _cacheManager = undefined;
            cb();
        });
    }
    return cb();
};

const init = (_config = true) => {
    const config = _config === true ? Object.assign({}, defaultConfig) : Object.assign({}, defaultConfig, _config);

    _ttlConfig = config.ttl;

    /**
     * Check if the cache is "redis"
     * If it is, we save the client to be able
     * to cache queries effectively.
     */
    const checkRedis = cache => {
        if (cache.store.name === 'redis') {
            _redisClient = cache.store.getClient();
        }
    };

    if (config.stores.length > 1) {
        _cacheManager = nodeCacheManager.multiCaching(config.stores);
        _cacheManager._caches.forEach(checkRedis);
    } else {
        _cacheManager = nodeCacheManager.caching(config.stores[0]);
        checkRedis(_cacheManager);
    }

    return _cacheManager;
};

const getKeys = (_keys, options = {}, fetchHandler) => {
    if (!_cacheManager || options.cache === false) {
        return fetchHandler(_keys);
    }

    const keys = arrify(_keys);
    const isMultiple = keys.length > 1;

    /**
     * Convert the keys to unique string id
     */
    const stringKeys = keys.map(dsKeytoString);

    if (isMultiple) {
        return _cacheManager.mget(...stringKeys).then(onResult);
    }

    return _cacheManager.get(stringKeys[0]).then(onResult);

    function onResult(_cacheResult) {
        const cacheResult = arrify(_cacheResult).filter(r => r !== undefined);

        if (cacheResult.length === 0) {
            /**
             * No cache we need to fetch the keys
             */
            return fetchHandler(...keys);
        }

        if (cacheResult.length !== keys.length) {
            /**
             * Cache returned some entities but not all of them
             */
            const cached = {};
            let strKey;

            const addToCache = entity => {
                strKey = dsKeytoString(entity[ds.KEY]);
                cached[strKey] = entity;
            };

            cacheResult.forEach(addToCache);
            const notFound = keys.filter(k => cached[dsKeytoString(k)] === undefined);

            return fetchHandler(notFound)
                .then(_fetchResult => {
                    const fetchResult = arrify(_fetchResult);
                    fetchResult.forEach(addToCache);
                })
                .catch(error => {
                    if (error.code === 404) {
                        // When we fetch *one* key and it is not found
                        // gstore.Model returns an error with 404 code.
                        strKey = dsKeytoString(notFound[0]);
                        cached[strKey] = null;
                        return;
                    }
                    throw new Error(error);
                })
                .then(() => {
                    const response = stringKeys.map(k => cached[k] || null);
                    return isMultiple ? response : response[0];
                });
        }
        return isMultiple ? cacheResult : cacheResult[0];
    }
};

const getQuery = () => {};

module.exports = {
    init,
    getKeys,
    getQuery,
    ttl,
    getRedisClient,
    getCacheManager,
    deleteCacheManager,
    utils,
};
