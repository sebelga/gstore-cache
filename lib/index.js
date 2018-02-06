'use strict';

const ds = require('@google-cloud/datastore')();
const nodeCacheManager = require('cache-manager');
const arrify = require('arrify');

const utils = require('./utils');

const { dsKeyToString } = utils.datastore;

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
    cachePrefix: {
        keys: 'gck:', // gstore cache key
        queries: 'gcq:', // gstore cache query
    },
    global: true,
};

/**
 * gstore-node error code when entity is not found.
 */
const ERR_ENTITY_NOT_FOUND = 'ERR_ENTITY_NOT_FOUND';

let cacheManager;
let redisClient;
let config;

const getConfig = () => config;
const getRedisClient = () => redisClient;
const getCacheManager = () => cacheManager;

const deleteCacheManager = cb => {
    if (cacheManager) {
        return cacheManager.reset(() => {
            cacheManager = undefined;
            cb();
        });
    }
    return cb();
};

const init = (_config = true) => {
    config = _config === true ? Object.assign({}, defaultConfig) : Object.assign({}, defaultConfig, _config);

    /**
     * Check if the cache is "redis"
     * If it is, we save the client to be able
     * to cache queries effectively.
     */
    const checkRedis = cache => {
        if (cache.store.name === 'redis') {
            redisClient = cache.store.getClient();
        }
    };

    if (config.stores.length > 1) {
        cacheManager = nodeCacheManager.multiCaching(config.stores);
        config.stores.forEach(checkRedis);
    } else {
        cacheManager = nodeCacheManager.caching(config.stores[0]);
        checkRedis(cacheManager);
    }

    return cacheManager;
};

/**
 * Concatenate key|value pairs and
 * call mset on the cacheManager
 */
const primeCache = (keys, values) => {
    const keysValues = keys.reduce((acc, key, index) => [...acc, key, values[index]], []);
    return cacheManager.mset(...keysValues).then(response => (response.length === 1 ? response[0] : response));
};

const addCachePrefixKeys = key => config.cachePrefix.keys + key;

const keyToString = key => addCachePrefixKeys(dsKeyToString(key));

const getKeys = (_keys, ...args) => {
    const fetchHandler = args.length > 1 ? args[1] : args[0];
    const options = args.length > 1 ? args[0] : {};

    if (!cacheManager || options.cache === false || (config.global === false && options.cache !== true)) {
        return fetchHandler(_keys);
    }

    const keys = arrify(_keys);
    const isMultiple = keys.length > 1;

    /**
     * Convert the keys to unique string id
     */
    const stringKeys = keys.map(keyToString);

    if (isMultiple) {
        return cacheManager.mget(...stringKeys).then(onResult);
    }

    return cacheManager.get(stringKeys[0]).then(onResult);

    function onResult(_cacheResult) {
        const cacheResult = arrify(_cacheResult).filter(r => r !== undefined);

        if (cacheResult.length === 0) {
            /**
             * No cache we need to fetch the keys
             */
            return fetchHandler(...keys).then(_fetchResult =>
                // Prime the cache
                primeCache(stringKeys, arrify(_fetchResult))
            );
        }

        if (cacheResult.length !== keys.length) {
            /**
             * The cache returned some entities but not all of them
             */
            const cached = {};
            let strKey;

            const addToCache = entity => {
                strKey = keyToString(entity[ds.KEY]);
                cached[strKey] = entity;
            };

            cacheResult.forEach(addToCache);
            const keysNotFound = keys.filter(k => cached[keyToString(k)] === undefined);

            return fetchHandler(keysNotFound)
                .then(_fetchResult => {
                    const fetchResult = arrify(_fetchResult);
                    fetchResult.forEach(addToCache);

                    /**
                     * Prime the cache
                     */
                    return primeCache(keysNotFound.map(keyToString), fetchResult);
                })
                .catch(error => {
                    if (error.code === ERR_ENTITY_NOT_FOUND) {
                        // When we fetch *one* key and it is not found
                        // gstore.Model returns an error with 404 code.
                        strKey = keyToString(keysNotFound[0]);
                        cached[strKey] = null;
                        return;
                    }
                    throw new Error(error);
                })
                .then(() =>
                    // Map the keys to our cached map
                    // return "null" if no result
                    stringKeys.map(k => cached[k] || null)
                );
        }
        return isMultiple ? cacheResult : cacheResult[0];
    }
};

const getQuery = () => {};

module.exports = {
    init,
    getKeys,
    getQuery,
    getConfig,
    getRedisClient,
    getCacheManager,
    deleteCacheManager,
    utils,
};
